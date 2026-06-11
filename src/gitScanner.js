const fs = require("fs");
const path = require("path");

/**
 * 递归扫描指定目录，识别所有包含 .git 的子目录（git 仓库）。
 * 命中后不再下钻该子目录，避免在仓库内部继续扫描。
 */
class GitScanner {
  /**
   * @param {object} options
   * @param {number} [options.maxDepth=5] 最大递归深度（相对根目录）
   * @param {string[]} [options.ignoreDirs] 需要跳过的目录名（小写匹配）
   * @param {string[]} [options.rootDirs] 一个或多个根目录
   */
  constructor(options = {}) {
    this.maxDepth = Math.max(1, options.maxDepth || 5);
    this.ignoreDirs = new Set(
      (options.ignoreDirs || [
        "node_modules",
        ".git",
        ".svn",
        ".hg",
        ".idea",
        ".vscode",
        "dist",
        "build",
        "out",
        "target",
        "coverage",
        ".next",
        ".nuxt",
        // Windows 系统目录
        "$recycle.bin",
        "system volume information",
        "$winreagent",
        // macOS / Linux 常见干扰目录
        ".Trash",
        ".Trash-1000",
        ".Spotlight-V100",
        ".fseventsd",
        "lost+found",
      ]).map((d) => String(d).toLowerCase())
    );
    this.rootDirs = Array.isArray(options.rootDirs) ? options.rootDirs : [];
  }

  /**
   * 扫描所有根目录，返回去重后的 git 仓库绝对路径列表。
   * @returns {string[]}
   */
  scan() {
    const found = new Set();
    for (const root of this.rootDirs) {
      if (!root) continue;
      const absRoot = path.resolve(root);
      if (!fs.existsSync(absRoot)) continue;
      try {
        const stat = fs.statSync(absRoot);
        if (!stat.isDirectory()) continue;
      } catch (e) {
        continue;
      }
      this._walk(absRoot, 0, found);
    }
    return Array.from(found);
  }

  _walk(dir, depth, found) {
    if (depth > this.maxDepth) return;

    // 命中 git 仓库：记录后不再下钻
    if (this._isGitRepo(dir)) {
      found.add(dir);
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // 无权限/IO 错误：跳过该目录
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nameLower = entry.name.toLowerCase();
      // 跳过以 . 开头的隐藏目录（包含 .git 已在 ignoreDirs 内）
      if (nameLower.startsWith(".")) continue;
      if (this.ignoreDirs.has(nameLower)) continue;

      const child = path.join(dir, entry.name);
      this._walk(child, depth + 1, found);
    }
  }

  _isGitRepo(dir) {
    try {
      const gitPath = path.join(dir, ".git");
      const stat = fs.statSync(gitPath);
      // .git 可能是目录（普通仓库）或文件（worktree/submodule 中的 gitfile）
      return stat.isDirectory() || stat.isFile();
    } catch (e) {
      return false;
    }
  }
}

module.exports = GitScanner;
