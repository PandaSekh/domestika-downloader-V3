# Contributing to Domestika Downloader

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Getting Started

### Prerequisites

- Node.js 22 or higher
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

### 4. Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

**Format:**
```
<type>(<scope>): <subject>
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

**Important:** 
- Commit messages are validated by Husky hooks and CI. Invalid commit messages will be rejected.

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

### 6. Submit a Pull Request

1. Push your branch:
   ```bash
   git push origin feat/your-feature-name
   ```

2. Create a PR on GitHub:
   - Fill out the PR template completely
   - Link any related issues

3. **PR Requirements:**
   - ✅ All CI checks must pass
   - ✅ Code must be formatted and linted
   - ✅ Commit messages must follow conventional commits
   - ✅ PR description must be complete

Thank you for contributing! 🎉