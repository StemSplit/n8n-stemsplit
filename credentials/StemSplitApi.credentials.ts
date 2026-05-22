import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from "n8n-workflow";

export class StemSplitApi implements ICredentialType {
	name = "stemSplitApi";
	displayName = "StemSplit API";
	documentationUrl = "https://stemsplit.io/docs/api";
	properties: INodeProperties[] = [
		{
			displayName: "API Key",
			name: "apiKey",
			type: "string",
			typeOptions: {
				password: true,
			},
			default: "",
			required: true,
			description:
				'Your StemSplit API key (starts with sk_live_). Generate one at <a href="https://stemsplit.io/app/settings/api" target="_blank">stemsplit.io/app/settings/api</a>.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: "generic",
		properties: {
			headers: {
				Authorization: "=Bearer {{$credentials.apiKey}}",
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: "https://stemsplit.io/api/v1",
			url: "/balance",
		},
	};
}
