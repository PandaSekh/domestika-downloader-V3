import * as fs from 'node:fs';
import * as path from 'node:path';
import inquirer from 'inquirer';
import 'dotenv/config';

export interface Cookie {
	name: string;
	value: string;
	domain: string;
}

export interface Credentials {
	cookies: Cookie[];
	_credentials_: string;
	getAccessToken: () => string;
}

export class DomestikaAuth {
	private envPath: string;
	public cookies: Cookie[] = [];
	public _credentials_ = '';

	constructor() {
		// Use current working directory for .env file
		this.envPath = path.join(process.cwd(), '.env');
		this.loadCredentials();
	}

	loadCredentials(): void {
		this.cookies = [
			{
				name: '_domestika_session',
				value: process.env.DOMESTIKA_SESSION || '',
				domain: 'www.domestika.org',
			},
		];
		this._credentials_ = process.env.DOMESTIKA_CREDENTIALS || '';
	}

	async promptForCredentials(forceUpdate = false): Promise<void> {
		console.log('\n📝 To get your credentials:');
		console.log('1. Log in to Domestika');
		console.log('2. Open Developer Tools (F12)');
		console.log('3. Go to the Storage tab -> Cookies');
		console.log('4. Find and copy the value of the following cookies:');
		console.log('   - _domestika_session');
		console.log('   - _credentials\n');

		const answers = await inquirer.prompt<{
			domestika_session?: string;
			credentials?: string;
		}>([
			{
				type: 'input',
				name: 'domestika_session',
				message: 'Enter the value of the _domestika_session cookie:',
				when: () => forceUpdate || !this.cookies[0].value,
			},
			{
				type: 'input',
				name: 'credentials',
				message: 'Enter the value of the _credentials cookie:',
				when: () => forceUpdate || !this._credentials_,
			},
		]);

		if (answers.domestika_session) {
			this.cookies[0].value = answers.domestika_session;
		}
		if (answers.credentials) {
			this._credentials_ = answers.credentials;
		}

		// Save credentials to .env file
		await this.saveCredentials();
	}

	async saveCredentials(): Promise<void> {
		const envContent = `# Domestika Credentials
DOMESTIKA_SESSION=${this.cookies[0].value}
DOMESTIKA_CREDENTIALS=${this._credentials_}`;

		fs.writeFileSync(this.envPath, envContent, 'utf8');

		// Update environment variables at runtime
		process.env.DOMESTIKA_SESSION = this.cookies[0].value;
		process.env.DOMESTIKA_CREDENTIALS = this._credentials_;
	}

	async validateCredentials(): Promise<boolean> {
		try {
			const regex_token = /accessToken":"(.*?)"/gm;
			const match = regex_token.exec(decodeURI(this._credentials_));

			if (!match || !this.cookies[0].value) {
				throw new Error('Invalid credentials');
			}

			return true;
		} catch (_error) {
			console.log('\nError: The credentials appear to be invalid.');
			return false;
		}
	}

	async getCookies(): Promise<Credentials> {
		// Validate and request credentials if necessary
		if (!(await this.validateCredentials())) {
			await this.promptForCredentials();

			// Validate again after obtaining credentials
			if (!(await this.validateCredentials())) {
				throw new Error(
					'Could not obtain valid credentials. Please verify your Domestika cookies.'
				);
			}
		}

		return {
			cookies: this.cookies,
			_credentials_: this._credentials_,
			getAccessToken: () => {
				const regex_token = /accessToken":"(.*?)"/gm;
				const match = regex_token.exec(decodeURI(this._credentials_));
				if (!match) {
					throw new Error('Could not extract access token from credentials');
				}
				return match[1];
			},
		};
	}
}

export default new DomestikaAuth();
