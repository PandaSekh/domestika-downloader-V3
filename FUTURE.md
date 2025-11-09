# Future Enhancements

This document outlines potential UX improvements and features that could be added to the Domestika Downloader in the future.

**Related Documentation:**
- [README.md](README.md) - Project overview, installation, and usage instructions
- [CONTRIBUTING.md](CONTRIBUTING.md) - Guidelines for contributing to the project

## Download Management

### Retry Mechanism
- Add configurable retry for failed downloads with exponential backoff (max 5 minute of wait at the last attempt)
- Allow users to specify max retry attempts (default is 5)
- Track retry attempts in progress.csv
- If cookies are not found, when requesting to the user what to do, after 30 seconds of inactivity default to "no" (tell the user in the log)

## User Experience

### Progress Indicators
- Show estimated download size if available
- Better progress summary during downloads
- Real-time download speed and ETA

### Summary Reports
- Generate HTML/JSON report after completion, in a .reports folder
- Include download statistics, failed items

## Developer Experience

### CLI Improvements
- all .env args can be passed as cli args for a temporary override. the flags avaialble should be the same 

## Quality of Life
- Download cover image
