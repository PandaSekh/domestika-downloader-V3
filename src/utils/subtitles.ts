// Helper function to parse subtitle languages from string (comma-separated) to array
export function parseSubtitleLanguages(subtitles: string | null): string[] | null {
	if (!subtitles || subtitles.trim() === '') {
		return null;
	}
	return subtitles
		.split(',')
		.map((lang) => lang.trim())
		.filter((lang) => lang.length > 0);
}
