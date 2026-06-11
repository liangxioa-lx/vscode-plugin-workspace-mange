const vscode = require("vscode");
const path = require("path");
const DirectoryProvider = require("./provider");
const WorkspaceDragDropController = require("./dragDropController");

function activate(context) {
  const directoryProvider = new DirectoryProvider(context);

  vscode.window.registerTreeDataProvider(
    "workspace-mange-view",
    directoryProvider
  );

  let reloadCommand = vscode.commands.registerCommand(
    "workspace-mange.reload",
    async () => {
      directoryProvider.reload();
    }
  );

  let addDirectoryCommand = vscode.commands.registerCommand(
    "workspace-mange.addDirectory",
    async (targetGroupItem) => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "选择要添加的目录",
      });

      if (result && result[0]) {
        const existingIndex = directoryProvider.findIndex(result[0].fsPath);
        if (existingIndex !== -1) {
          // 添加确认弹窗
          const result = await vscode.window.showWarningMessage(
            `该路径已存在，是否要修改其名称？`,
            { modal: true }, // 使用模态对话框
            "确定",
            "取消"
          );
          if (result === "取消") {
            return;
          }
        }

        const defaultName = path.basename(result[0].fsPath);
        const directoryLabel = await vscode.window.showInputBox({
          prompt: "为该目录输入一个名称",
          placeHolder: "例如：我的项目",
          value: defaultName,
        });

        if (directoryLabel) {
          directoryProvider.addDirectory(
            directoryLabel,
            result[0].fsPath,
            targetGroupItem
          );
        }
      }
    }
  );

  let addGroupCommand = vscode.commands.registerCommand(
    "workspace-mange.addGroup",
    async (parentGroupItem) => {
      directoryProvider.addGroup(parentGroupItem);
    }
  );

  let renameGroupCommand = vscode.commands.registerCommand(
    "workspace-mange.renameGroup",
    async (groupItem) => {
      directoryProvider.renameGroup(groupItem);
    }
  );

  let removeGroupCommand = vscode.commands.registerCommand(
    "workspace-mange.removeGroup",
    async (groupItem) => {
      directoryProvider.removeGroup(groupItem);
    }
  );

  let moveToGroupCommand = vscode.commands.registerCommand(
    "workspace-mange.moveToGroup",
    async (item) => {
      directoryProvider.pickAndMoveToGroup(item);
    }
  );

  // 批量移入分组：右键多选 / 命令面板均可触发
  let moveSelectedToGroupCommand = vscode.commands.registerCommand(
    "workspace-mange.moveSelectedToGroup",
    async (items) => {
      if (items && !Array.isArray(items)) items = [items];
      if (!Array.isArray(items) || items.length === 0) {
        // 从命令面板触发：取 TreeView 当前选区
        items = (treeView && treeView.selection) || [];
      }
      directoryProvider.pickAndMoveBatchToGroup(items);
    }
  );

  let removeDirectoryCommand = vscode.commands.registerCommand(
    "workspace-mange.removeDirectory",
    (item) => {
      directoryProvider.removeDirectory(item);
    }
  );

  let upDirectoryCommand = vscode.commands.registerCommand(
    "workspace-mange.upDirectory",
    (item) => {
      directoryProvider.upDirectory(item);
    }
  );

  let downDirectoryCommand = vscode.commands.registerCommand(
    "workspace-mange.downDirectory",
    (item) => {
      directoryProvider.downDirectory(item);
    }
  );

  let scanGitReposCommand = vscode.commands.registerCommand(
    "workspace-mange.scanGitRepos",
    async () => {
      await directoryProvider.scanAndMergeGitRepos();
    }
  );

  let openDirectoryCommand = vscode.commands.registerCommand(
    "workspace-mange.openDirectory",
    (item) => {
      try {
        const dirPath = typeof item === "string" ? item : item.dirPath;
        console.log("Opening directory:", dirPath); // 调试日志
        if (dirPath) {
          const uri = vscode.Uri.file(dirPath);
          vscode.commands
            .executeCommand("vscode.openFolder", uri, true)
            .then(() => {
              console.log("Directory opened successfully");
            })
            .catch((error) => {
              console.error("Error opening directory:", error);
              vscode.window.showErrorMessage("打开目录时发生错误");
            });
        } else {
          console.error("Invalid directory path:", item);
          vscode.window.showErrorMessage("无效的目录路径");
        }
      } catch (error) {
        console.error("Error in openDirectory command:", error);
        vscode.window.showErrorMessage("打开目录时发生错误");
      }
    }
  );

  let editNameCommand = vscode.commands.registerCommand(
    "workspace-mange.editName",
    (item) => {
      directoryProvider.editName(item);
    }
  );

  let editPathCommand = vscode.commands.registerCommand(
    "workspace-mange.editPath",
    (item) => {
      directoryProvider.editPath(item);
    }
  );

  // 注册搜索命令
  let searchCommand = vscode.commands.registerCommand(
    "workspace-mange.search",
    async () => {
      const query = await vscode.window.showInputBox({
        prompt: "输入搜索关键词",
        placeHolder: "例如：我的项目",
      });

      if (query) {
        directoryProvider.setSearchQuery(query);
      }
    }
  );

  // 注册视图选择事件
  const dragDropController = new WorkspaceDragDropController(directoryProvider);
  const treeView = vscode.window.createTreeView("workspace-mange-view", {
    treeDataProvider: directoryProvider,
    showCollapseAll: false,
    dragAndDropController,
    canSelectMany: true,
  });

  context.subscriptions.push(
    reloadCommand,
    addDirectoryCommand,
    addGroupCommand,
    renameGroupCommand,
    removeGroupCommand,
    moveToGroupCommand,
    moveSelectedToGroupCommand,
    removeDirectoryCommand,
    openDirectoryCommand,
    editNameCommand,
    editPathCommand,
    searchCommand,
    upDirectoryCommand,
    downDirectoryCommand,
    scanGitReposCommand
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
