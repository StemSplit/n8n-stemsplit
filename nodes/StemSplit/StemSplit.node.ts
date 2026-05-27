import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from "n8n-workflow";
import { NodeApiError, NodeOperationError, sleep } from "n8n-workflow";

const API_BASE = "https://stemsplit.io/api/v1";

type StemJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "EXPIRED";

interface StemJobOutput {
	url: string;
	expiresAt: string;
}

interface StemJobOutputs {
	vocals?: StemJobOutput;
	instrumental?: StemJobOutput;
	drums?: StemJobOutput;
	bass?: StemJobOutput;
	other?: StemJobOutput;
	piano?: StemJobOutput;
	guitar?: StemJobOutput;
}

interface StemJobResponse {
	id: string;
	status: StemJobStatus;
	progress: number;
	createdAt: string;
	startedAt?: string | null;
	completedAt?: string | null;
	estimatedSeconds?: number;
	creditsRequired?: number;
	creditsCharged?: number;
	input?: {
		fileName: string;
		durationSeconds?: number;
		fileSizeBytes?: number;
	};
	options?: {
		outputType: string;
		quality: string;
		outputFormat: string;
	};
	outputs: StemJobOutputs | null;
	metadata?: IDataObject | null;
	errorMessage?: string | null;
	expiresAt?: string;
}

interface UploadResponse {
	uploadUrl: string;
	uploadKey: string;
	expiresAt: string;
	maxFileSizeBytes: number;
	contentType: string;
}

interface BalanceResponse {
	balanceSeconds: number;
	balanceMinutes: number;
	balanceFormatted: string;
	updatedAt: string;
}

interface JobListResponse {
	jobs: StemJobResponse[];
	pagination: {
		total: number;
		limit: number;
		offset: number;
		hasMore: boolean;
	};
}

async function stemSplitRequest<T>(
	context: IExecuteFunctions,
	method: "GET" | "POST" | "PUT" | "DELETE",
	endpoint: string,
	body?: IDataObject,
	headers?: Record<string, string>,
): Promise<T> {
	const credentials = await context.getCredentials("stemSplitApi");
	const apiKey = credentials.apiKey as string;

	const requestHeaders: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		...headers,
	};

	const options: Parameters<typeof context.helpers.request>[0] = {
		method,
		url: endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`,
		headers: requestHeaders,
		json: true,
	};

	if (body && Object.keys(body).length > 0) {
		options.body = body;
	}

	try {
		const response = await context.helpers.request(options);
		return (typeof response === "string" ? JSON.parse(response) : response) as T;
	} catch (error) {
		if (error instanceof Error && "response" in error) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			throw new NodeApiError(context.getNode(), error as any);
		}
		throw error;
	}
}

/**
 * Upload binary data to a presigned S3/R2 URL.
 * Must NOT include an Authorization header — S3 will reject signed requests
 * that also carry a Bearer token.
 */
async function uploadToPresignedUrl(
	context: IExecuteFunctions,
	url: string,
	buffer: Buffer,
	contentType: string,
): Promise<void> {
	try {
		await context.helpers.request({
			method: "PUT",
			url,
			headers: {
				"Content-Type": contentType,
				"Content-Length": String(buffer.length),
			},
			body: buffer,
			json: false,
			encoding: null as unknown as string,
		});
	} catch (error) {
		if (error instanceof Error && "response" in error) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			throw new NodeApiError(context.getNode(), error as any);
		}
		throw error;
	}
}

async function pollJobUntilComplete(
	context: IExecuteFunctions,
	jobId: string,
	pollIntervalMs: number,
	timeoutMs: number,
	itemIndex: number,
	jobEndpointPrefix = "/jobs",
): Promise<StemJobResponse> {
	const startTime = Date.now();
	let elapsed = Date.now() - startTime;

	while (elapsed < timeoutMs) {
		const job = await stemSplitRequest<StemJobResponse>(
			context,
			"GET",
			`${jobEndpointPrefix}/${jobId}`,
		);

		if (job.status === "COMPLETED") return job;
		if (job.status === "FAILED") {
			throw new NodeOperationError(
				context.getNode(),
				`Job ${jobId} failed: ${job.errorMessage ?? "Unknown error"}`,
				{ itemIndex },
			);
		}
		if (job.status === "EXPIRED") {
			throw new NodeOperationError(context.getNode(), `Job ${jobId} has expired.`, {
				itemIndex,
			});
		}

		await sleep(pollIntervalMs);
		elapsed = Date.now() - startTime;
	}

	throw new NodeOperationError(
		context.getNode(),
		`Timed out waiting for job ${jobId} after ${Math.round(elapsed / 1000)}s. ` +
			`Use the "Get Job" operation to check status later.`,
		{ itemIndex },
	);
}

function flattenOutputs(outputs: StemJobOutputs | null): IDataObject {
	if (!outputs) return {};
	const flat: IDataObject = {};
	for (const [stem, data] of Object.entries(outputs)) {
		if (data) {
			flat[`${stem}Url`] = (data as StemJobOutput).url;
			flat[`${stem}ExpiresAt`] = (data as StemJobOutput).expiresAt;
		}
	}
	return flat;
}

const OPERATION_LABELS: Record<string, string> = {
	separateStems: "Separate Stems",
	separateStemsWait: "Separate Stems (Wait)",
	getJob: "Get Job",
	listJobs: "List Jobs",
	getBalance: "Get Balance",
};

export class StemSplit implements INodeType {
	description: INodeTypeDescription = {
		displayName: "StemSplit",
		name: "stemSplit",
		icon: "file:stemsplit.png",
		group: ["transform"],
		version: 1,
		subtitle: `={{${JSON.stringify(OPERATION_LABELS)}[$parameter["operation"]]}}`,
		description: "Separate audio tracks into individual stems (vocals, drums, bass, etc.) using StemSplit AI",
		defaults: {
			name: "StemSplit",
		},
		inputs: ["main"],
		outputs: ["main"],
		credentials: [
			{
				name: "stemSplitApi",
				required: true,
			},
		],
		properties: [
			// ──────────────────────────────────────────────────────────
			// Operation selector
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Operation",
				name: "operation",
				type: "options",
				noDataExpression: true,
				options: [
					{
						name: "Separate Stems",
						value: "separateStems",
						description: "Submit an audio file for stem separation and return a job ID immediately",
						action: "Separate stems",
					},
					{
						name: "Separate Stems (Wait for Completion)",
						value: "separateStemsWait",
						description: "Submit an audio file and wait until separation is complete, then return download URLs",
						action: "Separate stems and wait for completion",
					},
					{
						name: "Get Job",
						value: "getJob",
						description: "Get the status and outputs of a stem separation job",
						action: "Get job",
					},
					{
						name: "List Jobs",
						value: "listJobs",
						description: "List stem separation jobs for your account",
						action: "List jobs",
					},
					{
						name: "Get Balance",
						value: "getBalance",
						description: "Get your current credit balance",
						action: "Get balance",
					},
				],
				default: "separateStemsWait",
			},

			// ──────────────────────────────────────────────────────────
			// Shared: Input source (file vs URL)
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Input Source",
				name: "inputSource",
				type: "options",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
					},
				},
				options: [
					{
						name: "Binary File",
						value: "binary",
						description: "Upload a binary audio file from a previous node",
					},
					{
						name: "URL",
						value: "url",
						description: "Provide a publicly accessible URL to an audio file",
					},
					{
						name: "YouTube URL",
						value: "youtube",
						description:
							"Paste a YouTube video URL — outputs vocals + instrumental, MP3, best quality",
					},
					{
						name: "SoundCloud URL",
						value: "soundcloud",
						description:
							"Paste a SoundCloud track URL — outputs vocals + instrumental, MP3, best quality",
					},
				],
				default: "binary",
				noDataExpression: true,
			},

			// ──────────────────────────────────────────────────────────
			// Binary input: property name
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Input Binary Property",
				name: "binaryPropertyName",
				type: "string",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
						inputSource: ["binary"],
					},
				},
				default: "data",
				required: true,
				description: "Name of the binary property that contains the audio file",
			},

			// ──────────────────────────────────────────────────────────
			// URL input
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Audio URL",
				name: "sourceUrl",
				type: "string",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
						inputSource: ["url"],
					},
				},
				default: "",
				required: true,
				description: "Publicly accessible URL of the audio file to separate",
				placeholder: "https://example.com/song.mp3",
			},

			// ──────────────────────────────────────────────────────────
			// YouTube URL input
			// ──────────────────────────────────────────────────────────
			{
				displayName: "YouTube URL",
				name: "youtubeUrl",
				type: "string",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
						inputSource: ["youtube"],
					},
				},
				default: "",
				required: true,
				description:
					"URL of the YouTube video to separate (fixed output: vocals + instrumental, MP3, best quality)",
				placeholder: "https://www.youtube.com/watch?v=...",
			},

			// ──────────────────────────────────────────────────────────
			// SoundCloud URL input
			// ──────────────────────────────────────────────────────────
			{
				displayName: "SoundCloud URL",
				name: "soundcloudUrl",
				type: "string",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
						inputSource: ["soundcloud"],
					},
				},
				default: "",
				required: true,
				description:
					"URL of the SoundCloud track to separate (fixed output: vocals + instrumental, MP3, best quality)",
				placeholder: "https://soundcloud.com/artist/track",
			},

			// ──────────────────────────────────────────────────────────
			// Job options
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Output Type",
				name: "outputType",
				type: "options",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
					},
					hide: {
						inputSource: ["youtube", "soundcloud"],
					},
				},
				options: [
					{
						name: "Vocals + Instrumental",
						value: "BOTH",
						description: "Separate into vocals and instrumental",
					},
					{
						name: "Vocals Only",
						value: "VOCALS",
						description: "Extract vocals track only",
					},
					{
						name: "Instrumental Only",
						value: "INSTRUMENTAL",
						description: "Extract instrumental track only",
					},
					{
						name: "Four Stems",
						value: "FOUR_STEMS",
						description: "Separate into vocals, drums, bass, and other",
					},
					{
						name: "Six Stems",
						value: "SIX_STEMS",
						description: "Separate into vocals, drums, bass, other, piano, and guitar (requires Best quality)",
					},
				],
				default: "BOTH",
				description: "Which stems to separate the audio into",
			},
			{
				displayName: "Quality",
				name: "quality",
				type: "options",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
					},
					hide: {
						inputSource: ["youtube", "soundcloud"],
					},
				},
				options: [
					{
						name: "Best",
						value: "BEST",
						description: "Highest quality separation (slowest, required for Six Stems)",
					},
					{
						name: "Balanced",
						value: "BALANCED",
						description: "Good quality with moderate speed",
					},
					{
						name: "Fast",
						value: "FAST",
						description: "Fastest processing with acceptable quality",
					},
				],
				default: "BEST",
			},
			{
				displayName: "Output Format",
				name: "outputFormat",
				type: "options",
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
					},
					hide: {
						inputSource: ["youtube", "soundcloud"],
					},
				},
				options: [
					{ name: "MP3", value: "MP3" },
					{ name: "WAV", value: "WAV" },
					{ name: "FLAC", value: "FLAC" },
				],
				default: "MP3",
				description: "Audio format for the output stem files",
			},

			// ──────────────────────────────────────────────────────────
			// Additional options (foldable)
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Additional Options",
				name: "additionalOptions",
				type: "collection",
				placeholder: "Add option",
				default: {},
				displayOptions: {
					show: {
						operation: ["separateStems", "separateStemsWait"],
					},
					hide: {
						inputSource: ["youtube", "soundcloud"],
					},
				},
				options: [
					{
						displayName: "File Name",
						name: "fileName",
						type: "string",
						default: "",
						description: "Override the file name used for the job (optional)",
					},
					{
						displayName: "Metadata",
						name: "metadata",
						type: "json",
						default: "{}",
						description: "Custom metadata object echoed back in job responses (optional)",
					},
				],
			},

			// ──────────────────────────────────────────────────────────
			// Wait operation: polling settings
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Timeout (Seconds)",
				name: "timeoutSeconds",
				type: "number",
				displayOptions: {
					show: {
						operation: ["separateStemsWait"],
					},
				},
				default: 600,
				description: "Maximum number of seconds to wait for the job to complete before failing",
			},
			{
				displayName: "Poll Interval (Seconds)",
				name: "pollIntervalSeconds",
				type: "number",
				displayOptions: {
					show: {
						operation: ["separateStemsWait"],
					},
				},
				default: 5,
				description: "How often (in seconds) to check the job status",
			},

			// ──────────────────────────────────────────────────────────
			// Get Job
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Job ID",
				name: "jobId",
				type: "string",
				displayOptions: {
					show: {
						operation: ["getJob"],
					},
				},
				default: "",
				required: true,
				description: "The ID of the stem separation job to retrieve",
			},

			// ──────────────────────────────────────────────────────────
			// List Jobs
			// ──────────────────────────────────────────────────────────
			{
				displayName: "Filters",
				name: "listFilters",
				type: "collection",
				placeholder: "Add filter",
				default: {},
				displayOptions: {
					show: {
						operation: ["listJobs"],
					},
				},
				options: [
					{
						displayName: "Status",
						name: "status",
						type: "options",
						options: [
							{ name: "All", value: "" },
							{ name: "Pending", value: "PENDING" },
							{ name: "Processing", value: "PROCESSING" },
							{ name: "Completed", value: "COMPLETED" },
							{ name: "Failed", value: "FAILED" },
							{ name: "Expired", value: "EXPIRED" },
						],
						default: "",
						description: "Filter jobs by status",
					},
					{
						displayName: "Limit",
						name: "limit",
						type: "number",
						default: 20,
						description: "Max number of jobs to return (max 100)",
					},
					{
						displayName: "Offset",
						name: "offset",
						type: "number",
						default: 0,
						description: "Number of jobs to skip for pagination",
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter("operation", i) as string;

			try {
				// ────────────────────────────────────────────
				// GET BALANCE
				// ────────────────────────────────────────────
				if (operation === "getBalance") {
					const balance = await stemSplitRequest<BalanceResponse>(this, "GET", "/balance");
					returnData.push({ json: balance as unknown as IDataObject });
					continue;
				}

				// ────────────────────────────────────────────
				// GET JOB
				// ────────────────────────────────────────────
				if (operation === "getJob") {
					const jobId = this.getNodeParameter("jobId", i) as string;
					if (!jobId.trim()) {
						throw new NodeOperationError(this.getNode(), "Job ID is required", { itemIndex: i });
					}
					const job = await stemSplitRequest<StemJobResponse>(this, "GET", `/jobs/${jobId}`);
					returnData.push({
						json: {
							...(job as unknown as IDataObject),
							...flattenOutputs(job.outputs),
						},
					});
					continue;
				}

				// ────────────────────────────────────────────
				// LIST JOBS
				// ────────────────────────────────────────────
				if (operation === "listJobs") {
					const filters = this.getNodeParameter("listFilters", i) as IDataObject;
					const qs: Record<string, string | number> = {};
					if (filters.limit) qs.limit = filters.limit as number;
					if (filters.offset) qs.offset = filters.offset as number;
					if (filters.status) qs.status = filters.status as string;

					const queryString = Object.entries(qs)
						.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
						.join("&");
					const url = `/jobs${queryString ? `?${queryString}` : ""}`;

					const result = await stemSplitRequest<JobListResponse>(this, "GET", url);
					for (const job of result.jobs) {
						returnData.push({
							json: {
								...(job as unknown as IDataObject),
								...flattenOutputs(job.outputs),
								pagination: result.pagination as unknown as IDataObject,
							},
						});
					}
					continue;
				}

			// ────────────────────────────────────────────
			// SEPARATE STEMS (submit only) or
			// SEPARATE STEMS + WAIT
			// ────────────────────────────────────────────
			if (operation === "separateStems" || operation === "separateStemsWait") {
				const inputSource = this.getNodeParameter("inputSource", i) as string;

				// ── YouTube / SoundCloud fast-path ──
				if (inputSource === "youtube" || inputSource === "soundcloud") {
					const isYouTube = inputSource === "youtube";
					const urlParamName = isYouTube ? "youtubeUrl" : "soundcloudUrl";
					const urlBodyKey = isYouTube ? "youtubeUrl" : "soundcloudUrl";
					const createEndpoint = isYouTube ? "/youtube-jobs" : "/soundcloud-jobs";
					const pollEndpoint = isYouTube ? "/youtube-jobs" : "/soundcloud-jobs";

					const trackUrl = this.getNodeParameter(urlParamName, i) as string;
					if (!trackUrl.trim()) {
						throw new NodeOperationError(
							this.getNode(),
							`${isYouTube ? "YouTube" : "SoundCloud"} URL is required`,
							{ itemIndex: i },
						);
					}

					const job = await stemSplitRequest<StemJobResponse>(this, "POST", createEndpoint, {
						[urlBodyKey]: trackUrl,
					});

					if (operation === "separateStems") {
						returnData.push({
							json: {
								id: job.id,
								status: job.status,
								progress: job.progress,
								creditsRequired: job.creditsRequired,
								estimatedSeconds: job.estimatedSeconds,
								createdAt: job.createdAt,
								options: job.options as unknown as IDataObject,
								input: job.input as unknown as IDataObject,
								metadata: job.metadata as IDataObject,
							},
						});
					} else {
						const timeoutSeconds = this.getNodeParameter("timeoutSeconds", i) as number;
						const pollIntervalSeconds = this.getNodeParameter("pollIntervalSeconds", i) as number;

						const completed = await pollJobUntilComplete(
							this,
							job.id,
							Math.max(1, pollIntervalSeconds) * 1000,
							Math.max(10, timeoutSeconds) * 1000,
							i,
							pollEndpoint,
						);

						returnData.push({
							json: {
								...(completed as unknown as IDataObject),
								...flattenOutputs(completed.outputs),
							},
						});
					}

					continue;
				}

				// ── File / URL path ──
				const outputType = this.getNodeParameter("outputType", i) as string;
				const quality = this.getNodeParameter("quality", i) as string;
				const outputFormat = this.getNodeParameter("outputFormat", i) as string;
				const additionalOptions = this.getNodeParameter("additionalOptions", i) as IDataObject;

				const jobBody: IDataObject = { outputType, quality, outputFormat };

				if (additionalOptions.fileName) {
					jobBody.fileName = additionalOptions.fileName;
				}
				if (additionalOptions.metadata) {
					try {
						const meta =
							typeof additionalOptions.metadata === "string"
								? JSON.parse(additionalOptions.metadata as string)
								: additionalOptions.metadata;
						if (meta && typeof meta === "object" && Object.keys(meta).length > 0) {
							jobBody.metadata = meta;
						}
					} catch {
						this.logger.warn(
							`StemSplit: Could not parse metadata JSON — raw value: ${String(additionalOptions.metadata)}`,
						);
					}
				}

				if (inputSource === "url") {
					// Direct URL submission
					const sourceUrl = this.getNodeParameter("sourceUrl", i) as string;
					if (!sourceUrl.trim()) {
						throw new NodeOperationError(this.getNode(), "Audio URL is required", { itemIndex: i });
					}
					jobBody.sourceUrl = sourceUrl;
				} else {
					// Binary upload: POST /upload → PUT file (no auth) → use uploadKey
					const binaryPropertyName = this.getNodeParameter("binaryPropertyName", i) as string;
					const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);

					const filename = binaryData.fileName ?? "audio.mp3";
					const mimeType = binaryData.mimeType ?? "audio/mpeg";

					// Step 1: Request presigned upload URL from StemSplit API
					const upload = await stemSplitRequest<UploadResponse>(this, "POST", "/upload", {
						filename,
						contentType: mimeType,
					});

					// Step 2: PUT binary data directly to the presigned S3/R2 URL — NO auth headers
					const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
					await uploadToPresignedUrl(this, upload.uploadUrl, buffer as Buffer, mimeType);

					jobBody.uploadKey = upload.uploadKey;
					if (!additionalOptions.fileName) {
						jobBody.fileName = filename;
					}
				}

				// Step 3: Create the job
				const job = await stemSplitRequest<StemJobResponse>(this, "POST", "/jobs", jobBody);

				if (operation === "separateStems") {
					// Return immediately with job ID and initial status
					returnData.push({
						json: {
							id: job.id,
							status: job.status,
							progress: job.progress,
							creditsRequired: job.creditsRequired,
							estimatedSeconds: job.estimatedSeconds,
							createdAt: job.createdAt,
							options: job.options as unknown as IDataObject,
							input: job.input as unknown as IDataObject,
							metadata: job.metadata as IDataObject,
						},
					});
				} else {
					// Wait for completion
					const timeoutSeconds = this.getNodeParameter("timeoutSeconds", i) as number;
					const pollIntervalSeconds = this.getNodeParameter("pollIntervalSeconds", i) as number;

					const completed = await pollJobUntilComplete(
						this,
						job.id,
						Math.max(1, pollIntervalSeconds) * 1000,
						Math.max(10, timeoutSeconds) * 1000,
						i,
					);

					returnData.push({
						json: {
							...(completed as unknown as IDataObject),
							...flattenOutputs(completed.outputs),
						},
					});
				}

				continue;
			}

				throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
					itemIndex: i,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}
}
