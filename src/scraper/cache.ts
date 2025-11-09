import * as fs from 'node:fs';
import * as path from 'node:path';
import { getVideoId } from '../csv/progress';
import type { Unit } from '../types';
import { coverImageExists } from '../utils/download-cover';
import { normalizeDomestikaUrl } from '../utils/url';

interface CachedCourseMetadata {
	metadata: Unit[];
	timestamp: number;
	courseTitle: string | null;
	fullyDownloaded?: boolean; // Flag to indicate if all videos are downloaded
}

interface CacheFile {
	[normalizedCourseUrl: string]: CachedCourseMetadata;
}

const CACHE_DIR = path.join(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'course-metadata-cache.json');
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * Get the cache TTL from environment variable or use default
 */
function getCacheTTL(): number {
	const ttlEnv = process.env.CACHE_TTL;
	if (ttlEnv) {
		const ttl = Number.parseInt(ttlEnv, 10);
		if (!Number.isNaN(ttl) && ttl > 0) {
			return ttl;
		}
	}
	return DEFAULT_TTL_MS;
}

/**
 * Check if caching is disabled via environment variable
 */
function isCacheDisabled(): boolean {
	return process.env.NO_CACHE === 'true' || process.env.NO_CACHE === '1';
}

/**
 * Load the entire cache file
 */
function loadCacheFile(): CacheFile {
	if (!fs.existsSync(CACHE_FILE)) {
		return {};
	}

	try {
		const content = fs.readFileSync(CACHE_FILE, 'utf-8');
		return JSON.parse(content) as CacheFile;
	} catch (error) {
		const err = error as Error;
		console.warn(`Warning: Could not read cache file: ${err.message}`);
		return {};
	}
}

/**
 * Save the entire cache file
 */
function saveCacheFile(cache: CacheFile): void {
	try {
		// Ensure cache directory exists
		if (!fs.existsSync(CACHE_DIR)) {
			fs.mkdirSync(CACHE_DIR, { recursive: true });
		}
		fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
	} catch (error) {
		const err = error as Error;
		console.warn(`Warning: Could not write cache file: ${err.message}`);
	}
}

/**
 * Check if cached metadata is still valid based on TTL
 */
function isCacheValid(cached: CachedCourseMetadata): boolean {
	const ttl = getCacheTTL();
	const age = Date.now() - cached.timestamp;
	return age < ttl;
}

/**
 * Load cached course metadata if available and valid
 */
export function loadCourseMetadata(courseUrl: string): Unit[] | null {
	if (isCacheDisabled()) {
		return null;
	}

	const normalized = normalizeDomestikaUrl(courseUrl);
	const cache = loadCacheFile();
	const cached = cache[normalized.url];

	if (!cached) {
		return null;
	}

	if (!isCacheValid(cached)) {
		// Cache expired, remove it
		delete cache[normalized.url];
		saveCacheFile(cache);
		return null;
	}

	return cached.metadata;
}

/**
 * Save course metadata to cache
 */
export function saveCourseMetadata(
	courseUrl: string,
	metadata: Unit[],
	courseTitle: string | null,
	fullyDownloaded = false
): void {
	if (isCacheDisabled()) {
		return;
	}

	const normalized = normalizeDomestikaUrl(courseUrl);
	const cache = loadCacheFile();

	cache[normalized.url] = {
		metadata,
		timestamp: Date.now(),
		courseTitle,
		fullyDownloaded,
	};

	saveCacheFile(cache);
}

/**
 * Check if a course is fully downloaded by comparing cached metadata with completed videos
 */
export function isCourseFullyDownloaded(courseUrl: string, completedVideos: Set<string>): boolean {
	if (isCacheDisabled()) {
		return false;
	}

	const normalized = normalizeDomestikaUrl(courseUrl);
	const cache = loadCacheFile();
	const cached = cache[normalized.url];

	if (!cached || !cached.metadata || !isCacheValid(cached)) {
		return false;
	}

	// If already marked as fully downloaded, return true
	if (cached.fullyDownloaded === true) {
		return true;
	}

	// Check if all videos in the cached metadata are completed
	let totalVideos = 0;
	let completedCount = 0;

	for (const unit of cached.metadata) {
		for (let i = 0; i < unit.videoData.length; i++) {
			totalVideos++;
			const videoId = getVideoId(normalized.url, unit.unitNumber, i + 1);
			if (completedVideos.has(videoId)) {
				completedCount++;
			}
		}
	}

	// If all videos are completed, check if cover image also exists
	if (totalVideos > 0 && completedCount === totalVideos) {
		// Check if cover image exists
		const hasCover = coverImageExists(cached.courseTitle);
		if (hasCover) {
			// All videos and cover are downloaded, mark it in cache and return true
			cached.fullyDownloaded = true;
			cache[normalized.url] = cached;
			saveCacheFile(cache);
			return true;
		}
		// Videos are all downloaded but cover is missing - not fully downloaded yet
		return false;
	}

	return false;
}
