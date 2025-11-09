# Contributing to Domestika Downloader

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

**Related Documentation:**
- [README.md](README.md) - Project overview, installation, and usage instructions
- [FUTURE.md](FUTURE.md) - Potential future enhancements and features

## Getting Started

### Prerequisites

- Node.js 20 or higher
- npm
- Git
- ffmpeg (see README.md for installation instructions)
- N_m3u8DL-RE binary (see README.md)

### Local Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/domestika-downloader-V2.git
   cd domestika-downloader-V2
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create `.env` file:
   ```bash
   cp .env.example .env
   ```
   Then add your Domestika cookies to `.env` (see README.md for instructions)

5. Build the project:
   ```bash
   npm run build
   ```

6. Run the project:
   ```bash
   npm start
   ```

## Development Workflow

### 1. Create a Branch

Create a new branch for your changes:
```bash
git checkout -b feat/your-feature-name
```

### 2. Make Your Changes

- Write clean, maintainable code
- Follow the existing code style
- Add comments for complex logic
- Keep functions focused and small

### 3. Code Style

We use [BiomeJS](https://biomejs.dev/) for linting and formatting.

**Before committing:**
```bash
# Check for linting and formatting issues
npm run check

# Auto-fix issues
npm run check:fix
```

**Key style guidelines:**
- Use 2 spaces for indentation (tabs in config, spaces in code)
- Use single quotes for strings
- Always use semicolons
- Follow TypeScript strict mode rules
- Keep line width under 100 characters

### 4. Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

**Format:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Build system changes
- `ci`: CI/CD changes
- `chore`: Other changes (dependencies, etc.)
- `revert`: Revert a previous commit

**Examples:**
```bash
feat: add support for multiple subtitle languages
fix: resolve issue with course URL parsing
docs: update installation instructions
refactor: simplify video download logic
```

**Important:** 
- Commit messages are validated by Husky hooks and CI. Invalid commit messages will be rejected.
- Your commit messages directly determine version bumps and release notes. Write them carefully!

**Version Impact by Commit Type:**
- `feat:` → **Minor version bump** (e.g., 3.1.0 → 3.2.0)
- `fix:` → **Patch version bump** (e.g., 3.1.0 → 3.1.1)
- `perf:` → **Patch version bump** (e.g., 3.1.0 → 3.1.1)
- `feat!:` or `BREAKING CHANGE:` → **Major version bump** (e.g., 3.1.0 → 4.0.0)
- `docs:`, `style:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:` → **No release** (version unchanged)

### 5. Testing

Before submitting your PR:

1. **Type check:**
   ```bash
   npx tsc --noEmit
   ```

2. **Lint and format:**
   ```bash
   npm run check
   ```

3. **Build:**
   ```bash
   npm run build
   ```

4. **Test manually** (if applicable):
   - Test your changes with real course URLs
   - Verify error handling
   - Check edge cases

### 6. Submit a Pull Request

1. Push your branch:
   ```bash
   git push origin feat/your-feature-name
   ```

2. Create a PR on GitHub:
   - **IMPORTANT: Use a conventional commit format for the PR title** (e.g., `fix: preserve env vars when updating credentials`)
   - If your PR is squash-merged, the PR title becomes the commit message on `main`
   - Fill out the PR template completely
   - Link any related issues

3. **PR Requirements:**
   - ✅ All CI checks must pass
   - ✅ Code must be formatted and linted
   - ✅ Commit messages must follow conventional commits
   - ✅ **PR title must follow conventional commits format** (critical for releases!)
   - ✅ PR description must be complete

## Code Review Process

1. Maintainers will review your PR
2. Address any feedback or requested changes
3. Once approved, your PR will be merged
4. After merge, a release will be automatically created if there are releasable commits

## Release Process

Releases are fully automated using [semantic-release](https://semantic-release.gitbook.io/)! Here's how it works:

### Automatic Release Generation

When commits are pushed to `main`, semantic-release automatically:

1. **Analyzes commits** to determine if a release is needed based on conventional commit types
2. **Calculates the next version** (patch/minor/major) based on commit messages:
   - `feat:` commits → minor version bump
   - `fix:` or `perf:` commits → patch version bump
   - `feat!:` or commits with `BREAKING CHANGE:` → major version bump
   - Other commit types (`docs:`, `chore:`, etc.) → no release
3. **Generates CHANGELOG.md** with all changes since the last release
4. **Updates package.json** with the new version
5. **Creates a GitHub release** with comprehensive release notes grouped by type:
   - ✨ Features (`feat:`)
   - 🐛 Bug Fixes (`fix:`)
   - ⚡ Performance Improvements (`perf:`)
   - ♻️ Code Refactoring (`refactor:`)
   - 📚 Documentation (`docs:`)
   - 🔧 Chores (`chore:`)
6. **Commits and pushes** the version bump and changelog back to the repository

### Best Practices for Releases

1. **Write clear commit messages** - They become your release notes and determine version bumps!
2. **Use appropriate commit types** - This groups changes logically and controls versioning
3. **Use breaking change notation** - Add `!` after the type (e.g., `feat!:`) or include `BREAKING CHANGE:` in the footer for major versions
4. **Keep commits atomic** - One logical change per commit
5. **PR titles must follow conventional commits** - If using squash merge, the PR title becomes the commit message. Use formats like:
   - `fix: description of bug fix`
   - `feat: description of new feature`
   - `perf: description of performance improvement`


## Debugging Tips

### Enable Debug Mode

Set `DEBUG=true` in your `.env` file to see detailed logs:
- Memory usage statistics
- Subtitle download/embedding details
- File operations
- Download queue progress

### Testing Your Changes

1. Build the project: `npm run build`
2. Type check: `npx tsc --noEmit`
3. Lint: `npm run check`
4. Test manually with a real course URL

Thank you for contributing! 🎉

