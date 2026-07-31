# Pull Request Workflow Rules

- **Branch Protection**: Never commit or push code changes directly to the `master`, `main`, or `development` branches.
- **Workflow**: Always use the `.agents/skills/gh-pr-workflow` skill to create a feature branch, commit changes, push, and open a descriptive pull request for review.
- **PR Descriptions Formatting**: When creating or editing pull requests using the GitHub CLI (`gh`), always write the description to a temporary file and pass it via the `--body-file` flag. This avoids shell-specific newline (`\n` or `` `n ``) and backtick escaping problems.
