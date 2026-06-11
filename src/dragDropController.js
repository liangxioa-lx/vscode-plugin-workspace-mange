const vscode = require("vscode");

const VIEW_ID = "workspace-mange-view";
const TREE_MIME = `application/vnd.code.tree.${VIEW_ID}`;

/**
 * 拖拽控制器：把 TreeItem 的拖放事件翻译成对 DirectoryProvider 状态树的修改。
 *
 * Drop 语义：
 *   - 拖到分组   → 作为该分组的最后一个子项进入
 *   - 拖到目录   → 作为该目录的下一个兄弟插入（同 parentChildren 数组，target 之后一位）
 *   - 拖到空白区 → 移动到 state.roots 末尾
 *   - 自身 / 后代分组 → no-op（必要时弹错误提示）
 */
class WorkspaceDragDropController {
  /**
   * @param {import('./provider')} provider
   */
  constructor(provider) {
    this.provider = provider;
  }

  get dragMimeTypes() {
    return [TREE_MIME];
  }

  get dropMimeTypes() {
    return [TREE_MIME];
  }

  /**
   * 把被拖的 TreeItem 序列化到 DataTransfer。
   * 单选场景下 source 是单个 TreeItem。
   * @param {vscode.TreeItem} source
   * @param {vscode.DataTransfer} dataTransfer
   * @param {vscode.CancellationToken} _token
   */
  async handleDrag(source, dataTransfer, _token) {
    if (!source) return;
    const payload = {
      id: source.id,
      contextValue: source.contextValue,
      label: typeof source.label === "string" ? source.label : "",
      // Directory 节点若未传 id，用 dir:<path> 兜底
      fallbackId:
        source.contextValue === "directory" && !source.id
          ? `dir:${source.dirPath}`
          : source.id,
    };
    dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(payload));
  }

  /**
   * @param {vscode.TreeItem | undefined} target
   * @param {vscode.DataTransfer} dataTransfer
   * @param {vscode.CancellationToken} _token
   */
  async handleDrop(target, dataTransfer, _token) {
    const transferItem = dataTransfer.get(TREE_MIME);
    if (!transferItem) return;

    /** @type {{id?: string, contextValue?: string, label?: string, fallbackId?: string}} */
    const payload = transferItem.value || {};
    const sourceId = payload.id || payload.fallbackId;
    if (!sourceId) return;

    const sourceFound = this.provider.findNodeAndParentById(sourceId);
    if (!sourceFound) return;
    const sourceNode = sourceFound.node;
    const sourceType = sourceNode.type; // "group" | "directory"

    // 守卫 1: 拖到自己
    if (target && target.id && target.id === sourceId) return;

    // 守卫 2: 分组拖到自身的后代分组
    if (
      sourceType === "group" &&
      target &&
      target.contextValue === "group" &&
      this.provider.isDescendantGroup(target.id, sourceNode)
    ) {
      vscode.window.showErrorMessage("不能将分组移动到其子分组中");
      return;
    }

    // 守卫 3: 源已经住在目标分组里 → no-op（避免无意义重排）
    if (target && target.contextValue === "group" && target.id === sourceId) return;
    if (
      target &&
      target.contextValue === "group" &&
      sourceFound.parentChildren ===
        (this.provider.findNodeAndParentById(target.id)?.node?.children || [])
    ) {
      return;
    }

    // 解析落点
    if (!target) {
      this._relocate(sourceId, { kind: "root" });
      return;
    }

    if (target.contextValue === "group") {
      this._relocate(sourceId, { kind: "intoGroup", groupId: target.id });
      return;
    }

    if (target.contextValue === "directory") {
      const targetFound = this.provider.findNodeAndParentById(target.id);
      if (!targetFound) return;
      this._relocate(sourceId, {
        kind: "afterSibling",
        parentChildren: targetFound.parentChildren,
        index: targetFound.index,
        // 是否同数组：让 _relocate 内部判断（更稳）
        sameArrayAsSource: sourceFound.parentChildren === targetFound.parentChildren,
        sourceWasBeforeTarget: sourceFound.index < targetFound.index,
      });
      return;
    }
  }

  /**
   * 集中处理 splice，避免三种落点的状态变更逻辑分散。
   * @param {string} sourceId
   * @param {{kind:"root"} | {kind:"intoGroup", groupId:string} | {kind:"afterSibling", parentChildren:any[], index:number, sameArrayAsSource:boolean, sourceWasBeforeTarget:boolean}} dest
   */
  _relocate(sourceId, dest) {
    const found = this.provider.findNodeAndParentById(sourceId);
    if (!found) return;
    const [moving] = found.parentChildren.splice(found.index, 1);
    if (!moving) return;

    if (dest.kind === "root") {
      this.provider.state.roots.push(moving);
    } else if (dest.kind === "intoGroup") {
      const groupFound = this.provider.findNodeAndParentById(dest.groupId);
      if (groupFound && groupFound.node.type === "group") {
        groupFound.node.children.push(moving);
      } else {
        // 目标 group 消失（理论不应发生），降级到根
        this.provider.state.roots.push(moving);
      }
    } else if (dest.kind === "afterSibling") {
      const arr = dest.parentChildren;
      // 源被 splice 之后，目标的有效 index 取决于源的位置：
      //   - 源在目标之后：目标 index 不变
      //   - 源在目标之前：目标 index 左移 1
      // 但要再减去 1（因为新位置是"目标之后一位"）
      let insertAt;
      if (dest.sameArrayAsSource && dest.sourceWasBeforeTarget) {
        // 源已移除，目标在原 dest.index，左移 1 → 在 dest.index 处插入
        insertAt = dest.index;
      } else {
        // 源在目标之后（或者不在同一数组），目标仍在 dest.index
        insertAt = dest.index + 1;
      }
      arr.splice(insertAt, 0, moving);
    }

    this.provider.saveState();
    this.provider._onDidChangeTreeData.fire();
  }
}

module.exports = WorkspaceDragDropController;
