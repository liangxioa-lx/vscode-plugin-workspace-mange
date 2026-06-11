const vscode = require("vscode");
const path = require("path");
class Directory extends vscode.TreeItem {
  constructor(label, dirPath, options = {}) {
    // 使用不同的方式设置显示文本
    super("", vscode.TreeItemCollapsibleState.None);
    // 存储原始值
    this.id = options.id || `dir:${dirPath}`;
    this.label = label;
    this.dirPath = dirPath;
    this.contextValue = "directory";
    this.tooltip = `名称: ${label}\n路径: ${dirPath}`;

    let currentWorkspaceHasThis = false;
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length
    ) {
      let i = 0;
      for (; i < vscode.workspace.workspaceFolders.length; i++) {
        if (
          vscode.workspace.workspaceFolders[i].uri._fsPath ===
          path.resolve(dirPath)
        ) {
          currentWorkspaceHasThis = true;
          break;
        }
      }
    }
    if (currentWorkspaceHasThis) {
      this.iconPath = new vscode.ThemeIcon("star");
      this.tooltip = `当前工作区已打开\n${this.tooltip}`;
    } else {
      this.iconPath = new vscode.ThemeIcon("folder");
    }

    this.command = {
      command: "workspace-mange.openDirectory",
      title: "打开目录",
      arguments: [dirPath],
    };
  }
}

module.exports = Directory;
