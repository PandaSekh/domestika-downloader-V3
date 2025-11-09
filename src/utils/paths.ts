import { exec as execCallback } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execCallback);

// Helper function to get the download path from environment variable or default
export function getDownloadPath(): string {
	const envPath = process.env.DOWNLOAD_PATH;
	if (envPath) {
		// If it's an absolute path, use it as-is
		if (path.isAbsolute(envPath)) {
			return envPath;
		}
		// If it's a relative path, resolve it relative to current working directory
		return path.resolve(process.cwd(), envPath);
	}
	// Default to domestika_courses in current working directory
	return path.resolve(process.cwd(), 'domestika_courses');
}

// Helper function to verify yt-dlp is installed system-wide
export async function verifyYtDlp(): Promise<{ installed: boolean; version?: string; error?: string }> {
	try {
		const { stdout } = await exec('yt-dlp --version', { timeout: 5000 });
		const version = stdout.trim();
		return { installed: true, version };
	} catch (error) {
		const err = error as Error;
		return { installed: false, error: err.message };
	}
}

// Get yt-dlp command (system-wide, no path needed)
export function getYtDlpCommand(): string {
	return 'yt-dlp';
}
