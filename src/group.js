const vscode = require("vscode");

class Group extends vscode.TreeItem {
  constructor(label, groupId, hasChildren) {
    super(
      label,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );
    this.id = groupId;
    this.groupId = groupId;
    this.contextValue = "group";
    this.iconPath = new vscode.ThemeIcon("library");
    this.tooltip = `分组: ${label}`;
  }
}

module.exports = Group;

