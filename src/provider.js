const Directory = require("./directory");
const Group = require("./group");
const GitScanner = require("./gitScanner");
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

// 获取存储缓存信息的本地 JSON 文件路径
const getCacheFilePath = () => {
  // 获取用户目录
  const userDataDir = process.env.HOME || process.env.USERPROFILE || process.env.APPDATA;
  console.log('userDataDir',userDataDir)
  if (!userDataDir) {
    throw new Error("未找到工作区文件夹");
  }
  return path.join(userDataDir, "workspaceMangeCache.json");
};

const CACHE_VERSION = 2;

const newId = (prefix) =>
  `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const isGroupNode = (node) => node && node.type === "group";
const isDirectoryNode = (node) => node && node.type === "directory";

// 递归过滤：剔除指向不存在目录的项，以及位于系统隐藏目录（$RECYCLE.BIN 等）下的项
const SYSTEM_DIR_HINTS = ["$recycle.bin", "system volume information", "$winreagent"];
const isUnderSystemDir = (p) => {
  if (!p) return false;
  const lower = String(p).toLowerCase();
  return SYSTEM_DIR_HINTS.some((hint) => lower.includes(`\\${hint}\\`) || lower.includes(`/${hint}/`) || lower.endsWith(`\\${hint}`) || lower.endsWith(`/${hint}`));
};
const isDirectoryLive = (dirPath) => {
  if (!dirPath) return false;
  if (isUnderSystemDir(dirPath)) return false;
  try {
    return fs.existsSync(dirPath);
  } catch (e) {
    return false;
  }
};
const pruneInvalidDirectories = (nodes) => {
  if (!Array.isArray(nodes)) return [];
  const out = [];
  for (const node of nodes) {
    if (!node) continue;
    if (isGroupNode(node)) {
      const children = pruneInvalidDirectories(node.children || []);
      // 分组清空后保留空分组（用户可能特意留个空分组）；如果想去掉空分组，可改为 out.push({...node, children})
      out.push({ ...node, children });
      continue;
    }
    if (isDirectoryNode(node)) {
      if (isDirectoryLive(node.dirPath)) out.push(node);
      continue;
    }
  }
  return out;
};

const normalizeDirectoryNode = (node) => {
  if (!node) return null;
  const label = node.label || node.originalLabel;
  const dirPath = node.dirPath;
  if (!label || !dirPath) return null;
  return {
    type: "directory",
    id: node.id || `dir:${dirPath}`,
    label,
    dirPath,
  };
};

const normalizeGroupNode = (node) => {
  if (!node) return null;
  const label = node.label;
  if (!label) return null;
  const children = Array.isArray(node.children) ? node.children : [];
  const normalizedChildren = children
    .map((child) => normalizeNode(child))
    .filter(Boolean);
  return {
    type: "group",
    id: node.id || newId("grp"),
    label,
    children: normalizedChildren,
  };
};

const normalizeNode = (node) => {
  if (!node) return null;
  if (node.type === "group") return normalizeGroupNode(node);
  if (node.type === "directory") return normalizeDirectoryNode(node);
  // 兼容旧结构（目录数组项）
  if (node.dirPath) return normalizeDirectoryNode(node);
  return null;
};

class DirectoryProvider {
  constructor(context) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.context = context;
    this.state = this.loadState();
  }

  loadState() {
    try {
      const cacheFilePath = getCacheFilePath();
      if (fs.existsSync(cacheFilePath)) {
        const data = fs.readFileSync(cacheFilePath, "utf8");
        const parsed = JSON.parse(data);
        // 旧版本：直接保存目录数组
        if (Array.isArray(parsed)) {
          const roots = parsed
            .map((dir) => normalizeDirectoryNode(dir))
            .filter(Boolean);
          return this._postProcessLoaded({ version: CACHE_VERSION, roots });
        }
        // 新版本：{ version, roots }
        if (
          parsed &&
          parsed.version === CACHE_VERSION &&
          Array.isArray(parsed.roots)
        ) {
          const roots = parsed.roots.map((n) => normalizeNode(n)).filter(Boolean);
          return this._postProcessLoaded({ version: CACHE_VERSION, roots });
        }
      }
    } catch (error) {
      console.error("读取缓存文件时出错:", error);
    }
    return { version: CACHE_VERSION, roots: [] };
  }

  /**
   * 对 loadState 拿到的 roots 做一次后处理：剔除指向不存在目录 / 系统隐藏目录的项。
   * 若有剔除则立即落盘，让 cache 文件保持干净。
   * @param {{version:number, roots:any[]}} loaded
   */
  _postProcessLoaded(loaded) {
    const before = JSON.stringify(loaded.roots || []);
    const cleaned = { version: loaded.version, roots: pruneInvalidDirectories(loaded.roots || []) };
    const after = JSON.stringify(cleaned.roots);
    if (before !== after) {
      try {
        const cacheFilePath = getCacheFilePath();
        fs.writeFileSync(cacheFilePath, JSON.stringify(cleaned, null, 2));
      } catch (error) {
        console.error("清理脏数据时落盘失败:", error);
      }
    }
    return cleaned;
  }

  saveState() {
    try {
      const cacheFilePath = getCacheFilePath();
      fs.writeFileSync(cacheFilePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error("保存缓存文件时出错:", error);
    }
  }

  reload() {
    this.state = this.loadState();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  buildTreeItems(nodes) {
    return (nodes || []).map((node) => {
      if (isGroupNode(node)) {
        return new Group(node.label, node.id, (node.children || []).length > 0);
      }
      if (isDirectoryNode(node)) {
        return new Directory(node.label, node.dirPath, { id: node.id });
      }
      return null;
    }).filter(Boolean);
  }

  findNodeAndParentById(id, nodes = this.state.roots, parentChildren = null) {
    if (!Array.isArray(nodes)) return null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node && node.id === id) {
        return { node, parentChildren: parentChildren || this.state.roots, index: i };
      }
      if (isGroupNode(node)) {
        const found = this.findNodeAndParentById(id, node.children, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  findDirectoryNodeByPath(dirPath, nodes = this.state.roots) {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (isDirectoryNode(node) && node.dirPath === dirPath) return node;
      if (isGroupNode(node)) {
        const found = this.findDirectoryNodeByPath(dirPath, node.children);
        if (found) return found;
      }
    }
    return null;
  }

  listGroups(nodes = this.state.roots, parentPath = []) {
    const result = [];
    for (const node of nodes || []) {
      if (!isGroupNode(node)) continue;
      const pathParts = [...parentPath, node.label];
      result.push({ id: node.id, label: node.label, pathParts });
      result.push(...this.listGroups(node.children, pathParts));
    }
    return result;
  }

  getChildren(element) {
    if (!element) {
      return this.buildTreeItems(this.state.roots);
    }
    if (element.contextValue === "group") {
      const found = this.findNodeAndParentById(element.id);
      const children = found && isGroupNode(found.node) ? found.node.children : [];
      return this.buildTreeItems(children);
    }
    return [];
  }

  upDirectory(dirPath) {
    const itemId = typeof dirPath === "string" ? `dir:${dirPath}` : dirPath?.id;
    if (!itemId) return;
    const found = this.findNodeAndParentById(itemId);
    if (!found) return;
    const { parentChildren, index } = found;
    if (index <= 0) return;
    const tmp = parentChildren[index - 1];
    parentChildren[index - 1] = parentChildren[index];
    parentChildren[index] = tmp;
    this.saveState();
    this._onDidChangeTreeData.fire();
  }

  downDirectory(dirPath) {
    const itemId = typeof dirPath === "string" ? `dir:${dirPath}` : dirPath?.id;
    if (!itemId) return;
    const found = this.findNodeAndParentById(itemId);
    if (!found) return;
    const { parentChildren, index } = found;
    if (index < 0 || index >= parentChildren.length - 1) return;
    const tmp = parentChildren[index + 1];
    parentChildren[index + 1] = parentChildren[index];
    parentChildren[index] = tmp;
    this.saveState();
    this._onDidChangeTreeData.fire();
  }

  findIndex(dirPath) {
    return this.findDirectoryNodeByPath(dirPath) ? 0 : -1;
  }

  async addDirectory(label, dirPath, targetGroupItem) {
    const targetGroupId =
      targetGroupItem && targetGroupItem.contextValue === "group"
        ? targetGroupItem.id
        : null;

    const existing = this.findDirectoryNodeByPath(dirPath);
    if (existing) {
      existing.label = label;
      if (targetGroupId) {
        await this.moveNodeToGroup({ id: existing.id }, targetGroupId);
      } else {
        this.saveState();
        this._onDidChangeTreeData.fire();
      }
      return;
    }

    const node = {
      type: "directory",
      id: `dir:${dirPath}`,
      label,
      dirPath,
    };

    if (targetGroupId) {
      const found = this.findNodeAndParentById(targetGroupId);
      if (found && isGroupNode(found.node)) {
        found.node.children.push(node);
      } else {
        this.state.roots.push(node);
      }
    } else {
      this.state.roots.push(node);
    }
    this.saveState();
    this._onDidChangeTreeData.fire();
  }

  async removeDirectory(item) {
    const found = this.findNodeAndParentById(item.id || `dir:${item.dirPath}`);
    if (!found || !isDirectoryNode(found.node)) return;
    // 添加确认弹窗
    const result = await vscode.window.showWarningMessage(
      `确定要删除目录 "${item.label}" 吗？`,
      { modal: true }, // 使用模态对话框
      "确定",
      "取消"
    );

    if (result === "确定") {
      found.parentChildren.splice(found.index, 1);
      this.saveState();
      this._onDidChangeTreeData.fire();
    }
  }

  /**
   * 读取 VSCode 设置中配置的 git 根目录，递归扫描其中所有 git 仓库，
   * 并以「合并」方式追加到现有列表：
   *   - 路径已存在：跳过（保留用户自定义的 label）
   *   - 路径不存在：追加到根目录，label 使用仓库目录名
   *
   * 若未配置 git 根目录，则弹窗让用户选择（支持多选），
   * 选完后写入 workspaceMange.gitRootDirs 配置再继续扫描。
   *
   * @returns {Promise<{added:number, skipped:number, scanned:number, rootDirs:string[]} | null>}
   */
  async scanAndMergeGitRepos() {
    const config = vscode.workspace.getConfiguration("workspaceMange");
    let rootDirs = (config.get("gitRootDirs") || []).filter(Boolean);
    const maxDepth = config.get("scanMaxDepth") || 5;

    if (rootDirs.length === 0) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: true,
        title: "选择 Git 根目录（可多选）",
      });
      if (!picked || picked.length === 0) {
        vscode.window.showInformationMessage("已取消：未选择任何 Git 根目录。");
        return null;
      }
      rootDirs = picked.map((uri) => uri.fsPath);

      // 询问是否保存到用户/工作区配置
      const saveChoice = await vscode.window.showInformationMessage(
        `已选择 ${rootDirs.length} 个目录。是否保存到配置以便下次直接使用？`,
        "保存到用户设置",
        "保存到工作区设置",
        "本次不保存"
      );
      if (saveChoice === "保存到用户设置" || saveChoice === "保存到工作区设置") {
        const target =
          saveChoice === "保存到工作区设置"
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        try {
          await config.update("gitRootDirs", rootDirs, target);
        } catch (e) {
          vscode.window.showErrorMessage(`保存配置失败：${e.message || e}`);
        }
      }
    }

    if (rootDirs.length === 0) {
      return { added: 0, skipped: 0, scanned: 0, rootDirs: [] };
    }

    const repos = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在扫描 Git 目录",
        cancellable: false,
      },
      async () => {
        const scanner = new GitScanner({ rootDirs, maxDepth });
        return scanner.scan();
      }
    );

    let added = 0;
    let skipped = 0;
    for (const repoPath of repos) {
      const existing = this.findDirectoryNodeByPath(repoPath);
      if (existing) {
        skipped += 1;
        continue;
      }
      const node = {
        type: "directory",
        id: `dir:${repoPath}`,
        label: path.basename(repoPath) || repoPath,
        dirPath: repoPath,
      };
      this.state.roots.push(node);
      added += 1;
    }

    if (added > 0) {
      this.saveState();
      this._onDidChangeTreeData.fire();
    }

    vscode.window.showInformationMessage(
      `扫描完成：共发现 ${repos.length} 个仓库，新增 ${added} 个，跳过 ${skipped} 个。`
    );

    return { added, skipped, scanned: repos.length, rootDirs };
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async editName(item) {
    console.log("Editing directory name:", item);
    // 使用原始标签名称
    const nameInput = await vscode.window.showInputBox({
      title: "编辑目录名称",
      value: item.label || "",
      prompt: "输入新的目录名称",
      ignoreFocusOut: true,
      validateInput: (text) => {
        return text ? null : "名称不能为空";
      },
    });

    if (nameInput && nameInput !== item.label) {
      const found = this.findNodeAndParentById(item.id || `dir:${item.dirPath}`);
      if (!found || !isDirectoryNode(found.node)) return;
      found.node.label = nameInput;
      this.saveState();
      this._onDidChangeTreeData.fire();
    }
  }

  async editPath(item) {
    try {
      // 获取原始标签和路径
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(item.dirPath || ""),
        title: "选择新的目录路径",
      });

      if (result && result[0]) {
        const newPath = result[0].fsPath;
        console.log("New path selected:", newPath);

        const found = this.findNodeAndParentById(item.id || `dir:${item.dirPath}`);
        if (!found || !isDirectoryNode(found.node)) return;

        const existing = this.findDirectoryNodeByPath(newPath);
        if (existing && existing.id !== found.node.id) {
          vscode.window.showErrorMessage("该路径已存在于列表中，无法重复添加");
          return;
        }

        found.node.dirPath = newPath;
        found.node.id = `dir:${newPath}`;

        this.saveState();
        this._onDidChangeTreeData.fire();
      }
    } catch (error) {
      console.error("Error in editPath:", error);
      vscode.window.showErrorMessage("编辑路径时发生错误");
    }
  }

  async addGroup(parentGroupItem) {
    const parentGroupId =
      parentGroupItem && parentGroupItem.contextValue === "group"
        ? parentGroupItem.id
        : null;
    const name = await vscode.window.showInputBox({
      title: "新建分组",
      prompt: parentGroupId ? "输入子分组名称" : "输入分组名称",
      ignoreFocusOut: true,
      validateInput: (text) => (text ? null : "名称不能为空"),
    });
    if (!name) return;

    const node = { type: "group", id: newId("grp"), label: name, children: [] };
    if (parentGroupId) {
      const found = this.findNodeAndParentById(parentGroupId);
      if (found && isGroupNode(found.node)) {
        found.node.children.push(node);
      } else {
        this.state.roots.push(node);
      }
    } else {
      this.state.roots.push(node);
    }
    this.saveState();
    this._onDidChangeTreeData.fire();
  }

  async renameGroup(groupItem) {
    const found = this.findNodeAndParentById(groupItem.id);
    if (!found || !isGroupNode(found.node)) return;
    const name = await vscode.window.showInputBox({
      title: "重命名分组",
      value: found.node.label,
      prompt: "输入新的分组名称",
      ignoreFocusOut: true,
      validateInput: (text) => (text ? null : "名称不能为空"),
    });
    if (!name || name === found.node.label) return;
    found.node.label = name;
    this.saveState();
    this._onDidChangeTreeData.fire();
  }

  async removeGroup(groupItem) {
    const found = this.findNodeAndParentById(groupItem.id);
    if (!found || !isGroupNode(found.node)) return;
    const hasChildren = (found.node.children || []).length > 0;
    const message = hasChildren
      ? `分组 "${found.node.label}" 内含项目/子分组，如何处理？`
      : `确定要删除分组 "${found.node.label}" 吗？`;

    const options = hasChildren
      ? ["仅删除分组(保留内容)", "删除分组及其内容", "取消"]
      : ["确定", "取消"];
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      ...options
    );
    if (!choice || choice === "取消") return;

    if (!hasChildren && choice !== "确定") return;

    if (hasChildren && choice === "仅删除分组(保留内容)") {
      // 将子节点提升到父级同位置
      found.parentChildren.splice(found.index, 1, ...(found.node.children || []));
    } else {
      // 删除分组（含内容）
      found.parentChildren.splice(found.index, 1);
    }
    this.saveState();
    this._onDidChangeTreeData.fire();
  }

  isDescendantGroup(targetGroupId, maybeAncestorGroupNode) {
    if (!isGroupNode(maybeAncestorGroupNode)) return false;
    const stack = [...(maybeAncestorGroupNode.children || [])];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (isGroupNode(node)) {
        if (node.id === targetGroupId) return true;
        stack.push(...(node.children || []));
      }
    }
    return false;
  }

  async moveNodeToGroup(item, targetGroupId = null) {
    const sourceId = item?.id || (item?.dirPath ? `dir:${item.dirPath}` : null);
    if (!sourceId) return;
    const found = this.findNodeAndParentById(sourceId);
    if (!found) return;

    // 防止把分组移动到自身/子孙分组下
    if (isGroupNode(found.node) && targetGroupId) {
      if (targetGroupId === found.node.id) return;
      if (this.isDescendantGroup(targetGroupId, found.node)) {
        vscode.window.showErrorMessage("不能将分组移动到其子分组中");
        return;
      }
    }

    // 先从原位置移除
    const [moving] = found.parentChildren.splice(found.index, 1);

    if (!targetGroupId) {
      this.state.roots.push(moving);
      this.saveState();
      this._onDidChangeTreeData.fire();
      return;
    }

    const targetFound = this.findNodeAndParentById(targetGroupId);
    if (targetFound && isGroupNode(targetFound.node)) {
      targetFound.node.children.push(moving);
    } else {
      this.state.roots.push(moving);
    }
    this.saveState();
    this._onDidChangeTreeData.fire();
  }

  async pickAndMoveToGroup(item) {
    const groups = this.listGroups();
    const options = [
      { label: "（根目录）", description: "不属于任何分组", id: null },
      ...groups.map((g) => ({
        label: g.pathParts.join(" / "),
        description: "分组",
        id: g.id,
      })),
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: "移动到分组",
      canPickMany: false,
      matchOnDescription: true,
    });
    if (!picked) return;
    await this.moveNodeToGroup(item, picked.id);
  }

  /**
   * 将多个目录（不含 group）批量移入同一目标分组。
   * - 只接受 directory 节点；遇到 group 节点会跳过并提示
   * - 目标分组从所有分组中选（不限层级）
   * - 复用 moveNodeToGroup，保证单步守卫（不存在性、id 兜底等）一致
   * @param {Array<{id?:string,dirPath?:string,contextValue?:string}>} items
   */
  async pickAndMoveBatchToGroup(items) {
    if (!Array.isArray(items) || items.length === 0) return;

    // 过滤：只保留 directory 节点
    const dirItems = items.filter((it) => it && it.contextValue === "directory");
    const skippedGroups = items.length - dirItems.length;
    if (dirItems.length === 0) {
      vscode.window.showInformationMessage("请选择目录（暂不支持批量移动分组）。");
      return;
    }

    const groups = this.listGroups();
    const options = [
      { label: "（根目录）", description: "不属于任何分组", id: null },
      ...groups.map((g) => ({
        label: g.pathParts.join(" / "),
        description: "分组",
        id: g.id,
      })),
    ];
    const picked = await vscode.window.showQuickPick(options, {
      title: `将 ${dirItems.length} 个目录移入分组`,
      canPickMany: false,
      matchOnDescription: true,
    });
    if (!picked) return;

    let moved = 0;
    for (const it of dirItems) {
      const id = it.id || (it.dirPath ? `dir:${it.dirPath}` : null);
      if (!id) continue;
      const found = this.findNodeAndParentById(id);
      if (!found) continue;
      // 已在目标分组里则跳过
      if (picked.id) {
        const targetFound = this.findNodeAndParentById(picked.id);
        if (
          targetFound &&
          isGroupNode(targetFound.node) &&
          targetFound.node.children === found.parentChildren
        ) {
          continue;
        }
      } else {
        // 目标为根：源已在根则跳过
        if (found.parentChildren === this.state.roots) continue;
      }
      await this.moveNodeToGroup({ id }, picked.id);
      moved += 1;
    }

    const tail = skippedGroups > 0 ? `（已忽略 ${skippedGroups} 个非目录项）` : "";
    if (moved > 0) {
      vscode.window.showInformationMessage(
        `已移动 ${moved} 个目录到「${picked.label}」${tail}`
      );
    } else {
      vscode.window.showInformationMessage(`所选项已在目标位置，未发生移动${tail}`);
    }
  }
}

module.exports = DirectoryProvider;
