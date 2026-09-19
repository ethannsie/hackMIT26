# Repository workflow

Use this repository's local checkout for project work. On Davide's Mac, the
checkout is `/Users/davidefrati/Documents/1HackMIT` and the GitHub repository is
`ethannsie/hackMIT26`.

For every new change task:

1. Inspect the working tree and preserve any existing uncommitted work. Never
   discard changes or reset history to prepare a task.
2. Before editing, fetch origin, switch to the repository's default branch when
   safe, and pull it with `--ff-only`. Resolve any blocking local changes or
   divergence before continuing; do not silently overwrite them.
3. Create a new descriptive task branch from the updated default branch. When
   continuing an existing task or PR, use its existing branch instead.
4. Make the requested changes and run appropriate validation.
5. Commit the task changes, push the branch to origin, and create a GitHub pull
   request targeting the default branch when the work is ready. Update the
   existing PR when continuing a task.
6. Report the PR link and validation results. Do not push changes directly to
   the default branch or merge the PR unless the user requests it.

The user has requested this pull, branch, and PR workflow for future work in
this folder; routine commits, branch pushes, and PR creation are authorized.
