import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Unit } from '../types';
import { normalizeDomestikaUrl } from '../utils/url';

interface CachedCourseMetadata {
	metadata: Unit[];
	timestamp: number;
	courseTitle: string | null;
}

interface CacheFile {
	[normalizedCourseUrl: string]: CachedCourseMetadata;
}

const CACHE_FILE = path.join(process.cwd(), 'course-metadata-cache.json');
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
	courseTitle: string | null
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
	};

	saveCacheFile(cache);
}

