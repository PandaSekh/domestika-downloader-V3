const FLAG_MAPPINGS: Record<string, string> = {
	'--download-path': 'DOWNLOAD_PATH',
	'--debug': 'DEBUG',
	'--max-concurrent-downloads': 'MAX_CONCURRENT_DOWNLOADS',
	'--cache-ttl': 'CACHE_TTL',
	'--no-cache': 'NO_CACHE',
	'--max-retry-attempts': 'MAX_RETRY_ATTEMPTS',
	'--domestika-session': 'DOMESTIKA_SESSION',
	'--domestika-credentials': 'DOMESTIKA_CREDENTIALS',
};

/**
 * Parse CLI arguments and override environment variables
 * CLI arguments take precedence over .env values
 */
export function parseCliArgs(): void {
	const args = process.argv.slice(2);

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const envVar = FLAG_MAPPINGS[arg];

		if (envVar) {
			// Handle boolean flags (--no-cache, --debug)
			if (arg === '--no-cache') {
				process.env[envVar] = 'true';
			} else if (arg === '--debug') {
				// Check if next arg is a value or if it's a flag
				const nextArg = args[i + 1];
				if (nextArg && !nextArg.startsWith('--')) {
					process.env[envVar] = nextArg;
					i++; // Skip next arg
				} else {
					process.env[envVar] = 'true';
				}
			} else {
				// Get the value from next argument
				const value = args[i + 1];
				if (value && !value.startsWith('--')) {
					process.env[envVar] = value;
					i++; // Skip next arg
				}
			}
		}
	}
}

/**
 * Get CLI arguments with flags filtered out (for course URL parsing)
 */
export function getFilteredCliArgs(): string[] {
	const args = process.argv.slice(2);
	const filtered: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const envVar = FLAG_MAPPINGS[arg];

		if (envVar) {
			// Skip the flag
			// If it's not a boolean flag, skip the next arg too (the value)
			if (arg !== '--no-cache' && arg !== '--debug') {
				i++; // Skip the value
			} else if (arg === '--debug') {
				// Check if next arg is a value
				const nextArg = args[i + 1];
				if (nextArg && !nextArg.startsWith('--')) {
					i++; // Skip the value
				}
			}
		} else {
			// Not a flag, keep it
			filtered.push(arg);
		}
	}

	return filtered;
}

