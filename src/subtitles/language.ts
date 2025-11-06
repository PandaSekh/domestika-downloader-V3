// Helper function to detect language code from file path
export function getLanguageCode(subtitlePath: string): string {
	if (subtitlePath.includes('.en.')) return 'eng';
	if (subtitlePath.includes('.es.')) return 'spa';
	if (subtitlePath.includes('.pt.')) return 'por';
	if (subtitlePath.includes('.fr.')) return 'fra';
	if (subtitlePath.includes('.de.')) return 'deu';
	if (subtitlePath.includes('.it.')) return 'ita';
	// Try with underscore or hyphen separators
	if (subtitlePath.includes('_en.') || subtitlePath.includes('-en.')) return 'eng';
	if (subtitlePath.includes('_es.') || subtitlePath.includes('-es.')) return 'spa';
	if (subtitlePath.includes('_pt.') || subtitlePath.includes('-pt.')) return 'por';
	if (subtitlePath.includes('_fr.') || subtitlePath.includes('-fr.')) return 'fra';
	if (subtitlePath.includes('_de.') || subtitlePath.includes('-de.')) return 'deu';
	if (subtitlePath.includes('_it.') || subtitlePath.includes('-it.')) return 'ita';
	return 'und';
}
