import * as fs from 'node:fs';
import * as path from 'node:path';

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

// Helper function to get the path to N_m3u8DL-RE binary
export function getN3u8DLPath(): string {
	const binaryName = process.platform === 'win32' ? 'N_m3u8DL-RE.exe' : 'N_m3u8DL-RE';
	const devPath = path.join(process.cwd(), binaryName);
	if (fs.existsSync(devPath)) {
		return devPath;
	}
	return `./${binaryName}`;
}
