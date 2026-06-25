const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const allowedBranchPrefixes = ['release-'];

function runGit(args, options) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function safeRunGit(args) {
  try {
    return runGit(args);
  } catch (_) {
    return '';
  }
}

function readJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${label}: ${err.message}`);
  }
}

function currentBranch() {
  return safeRunGit(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function isReleaseBranch(branch) {
  return allowedBranchPrefixes.some(prefix => branch === prefix.slice(0, -1) || branch.startsWith(prefix));
}

function headTouchesPackageJson() {
  const changed = safeRunGit(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD', '--', 'package.json']);
  return changed.split(/\r?\n/).includes('package.json');
}

function headPackageVersion() {
  const text = runGit(['show', 'HEAD:package.json']);
  return readJson(text, 'HEAD:package.json').version;
}

function previousPackageVersion() {
  const parent = safeRunGit(['rev-parse', '--verify', 'HEAD^']);
  if (!parent) return '';
  const text = safeRunGit(['show', 'HEAD^:package.json']);
  if (!text) return '';
  return readJson(text, 'HEAD^:package.json').version || '';
}

function workingTreePackageVersion() {
  const text = fs.readFileSync(packageJsonPath, 'utf8');
  return readJson(text, 'package.json').version;
}

function ensureTag(tagName) {
  const existing = safeRunGit(['tag', '--list', tagName]);
  if (existing === tagName) return false;
  runGit(['tag', '-a', tagName, '-m', `Release ${tagName}`], { stdio: 'inherit' });
  return true;
}

function main() {
  const branch = currentBranch();
  if (!isReleaseBranch(branch)) return;
  if (!headTouchesPackageJson()) return;

  const headVersion = String(headPackageVersion() || '').trim();
  const previousVersion = String(previousPackageVersion() || '').trim();
  const workingVersion = String(workingTreePackageVersion() || '').trim();

  if (!headVersion || headVersion !== workingVersion) return;
  if (headVersion === previousVersion) return;

  const tagName = `v${headVersion}`;
  const created = ensureTag(tagName);
  if (!created) {
    console.log(`[release-tag] Tag ${tagName} already exists, skip.`);
    return;
  }

  console.log(`[release-tag] Created ${tagName} on ${branch}.`);
  console.log(`[release-tag] Next: git push origin ${branch} && git push origin ${tagName}`);
}

try {
  main();
} catch (err) {
  console.error(`[release-tag] ${err.message}`);
  process.exitCode = 1;
}
