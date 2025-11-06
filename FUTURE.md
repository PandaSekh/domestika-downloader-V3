# Future Enhancements

This document outlines potential UX improvements and features that could be added to the Domestika Downloader in the future.

**Related Documentation:**
- [README.md](README.md) - Project overview, installation, and usage instructions
- [CONTRIBUTING.md](CONTRIBUTING.md) - Guidelines for contributing to the project

## Download Management

### Retry Mechanism
- Add configurable retry for failed downloads with exponential backoff
- Allow users to specify max retry attempts
- Track retry attempts in progress.csv

### Resume Capability
- Better handling of interrupted downloads
- Check for partial files before redownloading
- Resume from where download stopped

### Batch Operations
- Add "retry all failed" command
- Batch download management interface
- Queue management (pause/resume entire queue)

## User Experience

### Progress Indicators
- Show estimated download size if available
- Better progress summary during downloads
- Real-time download speed and ETA

### Summary Reports
- Generate downloadable HTML/JSON report after completion
- Include download statistics, failed items

## Platform Support

### Windows Support
- Add it

## Developer Experience

### CLI Improvements
- Better CLI argument parsing
- Configuration via command-line flags

## Quality of Life

- Auto-detect available subtitle languages
- Auto-select best quality
- Smart retry with different options on failure
- Download cover image

## Performance

### Optimization
- Parallel scraping of course pages
- Cache course metadata to avoid re-scraping
- Streaming downloads for large files

---

**Note**: These are potential future enhancements. No timeline or commitment is implied. Features will be added based on user feedback and project priorities.

