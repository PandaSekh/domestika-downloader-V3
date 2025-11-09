# Domestika Course Downloader V3

![Version](https://img.shields.io/badge/version-3.1.0-blue.svg)
![License](https://img.shields.io/badge/license-ISC-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)

A tool to download Domestika courses you have purchased. This version is tested on macOS and Linux/Unix systems.

⚠️ **IMPORTANT:** This tool only works with courses you have purchased. You must be the legitimate owner of the courses you want to download.

## Table of Contents

- [How It Works](#how-it-works)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [File Structure](#file-structure)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Future Enhancements](#future-enhancements)
- [License](#license)

## How It Works

The downloader uses your Domestika session cookies to authenticate and download course videos. It:

1. Accepts course URLs in any format (main page, specific units, or course pages)
2. Authenticates using cookies stored in a `.env` file
3. Downloads videos using `N_m3u8DL-RE` for HLS streams
4. Processes videos with `ffmpeg` to embed subtitles and convert to MP4
5. Organizes downloads by course and section

## Features

- **Multiple course downloads**: Download several courses simultaneously
- **Flexible URL support**: Accepts any Domestika URL format:
  - Course main page: `https://www.domestika.org/en/courses/1234-course-name`
  - Specific unit: `https://www.domestika.org/en/courses/1234-course-name/units/5678-unit`
  - Course page: `https://www.domestika.org/en/courses/1234-course-name/course`
- **Subtitle support**: Download subtitles in multiple languages (Spanish, English, Portuguese, French, German, Italian)
  - Subtitles are embedded as tracks in the MP4 video
  - Independent SRT files are also generated
- **Automatic credential management**: Cookies are stored securely in `.env` and validated automatically
- **Parallel downloads**: Multiple videos download simultaneously for faster processing
- **Progress tracking**: Detailed progress information for each download
- **Error handling**: Automatic retry with cookie refresh when authentication fails

## Prerequisites

### macOS
1. **ffmpeg**:
   ```bash
   brew install ffmpeg
   ```

### Linux/Unix
1. **ffmpeg**:
   - Ubuntu/Debian:
     ```bash
     sudo apt update && sudo apt install ffmpeg
     ```
   - Fedora/RHEL:
     ```bash
     sudo dnf install ffmpeg
     ```
   - Arch Linux:
     ```bash
     sudo pacman -S ffmpeg
     ```
   - Or install from [ffmpeg.org](https://ffmpeg.org/download.html)

### All Platforms
2. **N_m3u8DL-RE**:
   - Download the appropriate binary for your platform from [GitHub releases](https://github.com/nilaoda/N_m3u8DL-RE/releases)
   - Place it in the project folder
   - Make sure the name is `N_m3u8DL-RE` (without extension on Unix-like systems, or `N_m3u8DL-RE.exe` on Windows)
   - Make it executable (Unix-like systems):
     ```bash
     chmod +x N_m3u8DL-RE
     ```

3. **Node.js and npm**

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/PandaSekh/domestika-downloader-V3.git
   cd domestika-downloader-V2
   ```

2. Install dependencies:
   ```bash
   npm i
   ```

## Usage

1. Run the program:
   ```bash
   npm start
   ```

2. **First-time setup** (if cookies are not configured):
   - The program will prompt you to provide your Domestika cookies
   - Open your browser's Developer Tools (F12)
   - Go to Storage → Cookies
   - Copy the values for:
     - `_domestika_session`
     - `_credentials`
   - Cookies are saved to `.env` automatically

3. **Enter course URLs**:
   - Enter one or multiple URLs separated by spaces
   - Any valid Domestika course URL format is accepted

4. **Select subtitles**:
   - Choose if you want to download subtitles
   - Select your preferred language

5. **Monitor downloads**:
   - Progress is shown for each video
   - If authentication fails, you'll be prompted to update cookies

## Configuration

### Download Path

Set a custom download location by adding to your `.env` file:

```
DOWNLOAD_PATH=/path/to/your/downloads/courses
```

- Use an absolute path for a specific location
- Use a relative path (e.g., `./my_courses`) for a folder in the project directory
- If not set, defaults to `domestika_courses/` in the project directory

### Credentials

Cookies are stored in `.env` and automatically validated. If cookies expire or become invalid, the program will prompt you to update them.

### Debug Mode

Enable detailed logging by adding to your `.env` file:

```
DEBUG=true
```

When enabled, shows additional debug information including:
- Memory usage statistics
- ffmpeg commands being executed
- File operations (subtitle deletion, file sizes, etc.)
- Download queue progress details
- CSV loading statistics

This is useful for troubleshooting issues or understanding what the downloader is doing behind the scenes. By default, debug mode is disabled (`DEBUG=false`).

## File Structure

Downloads are organized as follows:

```
[DOWNLOAD_PATH]/
└── Course Name/
    └── Section/
        ├── Course Name - U1 - 1_Video Name.mp4
        └── Course Name - U1 - 1_Video Name.srt
```

## Input CSV Format

You can use `input.csv` to batch download multiple courses. Create a file named `input.csv` in the project root with the following format:

```csv
url;subtitles;downloadOption
https://www.domestika.org/en/courses/1234-course-name;es,en;all
https://www.domestika.org/en/courses/5678-another-course;en;specific
```

**Columns:**
- `url`: Course URL (required)
- `subtitles`: Comma-separated language codes (optional): `es`, `en`, `pt`, `fr`, `de`, `it`
- `downloadOption`: `all` or `specific` (optional, defaults to `all`)

**Note:** The CSV uses semicolon (`;`) as delimiter.

## Troubleshooting

### Subtitles Not Embedding

If subtitles are not being embedded into videos:

1. **Check if subtitles were downloaded:**
   - Look for `.srt` files in the download directory
   - Enable debug mode (`DEBUG=true` in `.env`) to see detailed logs

2. **Verify subtitle format:**
   - Subtitles must be in SRT format
   - Check that subtitle files are not empty
   - Ensure files contain valid timestamps and text

3. **Check ffmpeg installation:**
   - Run `ffmpeg -version` to verify ffmpeg is installed
   - Ensure ffmpeg is in your PATH

4. **Review error messages:**
   - The tool logs detailed error messages when subtitle operations fail
   - Check console output for warnings like `⚠️ Failed to download [LANG] subtitles`

5. **Common issues:**
   - **Subtitle language not available**: Some videos may not have subtitles in your selected language
   - **File naming mismatch**: N_m3u8DL-RE may save subtitles with different naming patterns
   - **ffmpeg errors**: Check that your ffmpeg version supports subtitle embedding

### Authentication Issues

If you get authentication errors:

1. **Update cookies:**
   - Cookies expire after some time
   - The tool will prompt you to update cookies when they're invalid
   - Get fresh cookies from your browser's Developer Tools

2. **Verify cookie format:**
   - Ensure `DOMESTIKA_SESSION` and `DOMESTIKA_CREDENTIALS` are set correctly in `.env`
   - Copy the full cookie values without extra spaces or quotes

### Download Failures

If downloads fail:

1. **Check N_m3u8DL-RE:**
   - Verify the binary exists and is executable
   - Ensure it's the correct version for your platform

2. **Network issues:**
   - Check your internet connection
   - Some videos may require multiple retry attempts

3. **Disk space:**
   - Ensure you have enough disk space for downloads
   - Videos can be large (hundreds of MB to several GB)

4. **Enable debug mode:**
   - Set `DEBUG=true` in `.env` for detailed error information

## FAQ

### Can I download courses I haven't purchased?

No. This tool only works with courses you have legitimately purchased. You must use your own Domestika account cookies.

### Why are subtitles not working?

See the [Troubleshooting](#troubleshooting) section above. Common causes include:
- Subtitle language not available for that video
- ffmpeg not installed or not in PATH
- Subtitle file format issues

### Can I download multiple courses at once?

Yes! You can:
- Enter multiple URLs separated by spaces when prompted
- Use `input.csv` to batch process multiple courses
- The tool processes courses sequentially but downloads videos in parallel

### What video quality is downloaded?

The tool attempts to download 1080p first, then falls back to the best available quality if 1080p is not available.

### How do I change the download location?

Set the `DOWNLOAD_PATH` environment variable in your `.env` file:
```
DOWNLOAD_PATH=/path/to/your/downloads
```

### Is Windows supported?

Currently, the tool is only tested on macOS and Linux/Unix systems.

### How do I update my cookies?

The tool will automatically prompt you when cookies expire. You can also manually update them in the `.env` file or run the tool and it will ask for new cookies.

### Can I resume interrupted downloads?

The tool checks for existing video files and skips already downloaded videos. If a download is interrupted, you can run the tool again and it will continue from where it left off.

### What subtitle languages are supported?

Supported languages: Spanish (`es`), English (`en`), Portuguese (`pt`), French (`fr`), German (`de`), Italian (`it`). You can select multiple languages separated by commas.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Future Enhancements

For potential future enhancements and features, see [FUTURE.md](FUTURE.md).

## License

ISC