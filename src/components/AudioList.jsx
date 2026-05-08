/**
 * 音频列表组件 - 支持分页显示
 */
import React from 'react';
import { useTest, actions } from '../stores/testStore';
import { formatDuration, getSourceInfo } from '../utils/audioUtils.jsx';
import { PAGE_SIZE } from '../constants';
import useAudioPlayer from '../hooks/useAudioPlayer';
import usePagination from '../hooks/usePagination';
import useSelection from '../hooks/useSelection';

export default function AudioList() {
  const { state, dispatch } = useTest();
  const { testAudios, playback } = state;
  const [selectedModule, setSelectedModule] = React.useState('all');
  const [expandedGroups, setExpandedGroups] = React.useState({});

  const getDirectoryLabel = React.useCallback((audio) => {
    const name = String(audio?.tapdCategoryName || '').trim();
    const caseDirectory = String(audio?.caseDirectory || '').trim();
    const moduleName = String(audio?.module || '').trim();
    const rawPath = String(audio?.tapdCategoryPath || '').trim();

    const pathLooksLikeId = /^[\d\s,|\-_/]+$/.test(rawPath);
    const readablePath = rawPath && !pathLooksLikeId ? rawPath : '';

    return name || caseDirectory || readablePath || moduleName || '未分类目录';
  }, []);

  const generatedAudios = React.useMemo(() => {
    return testAudios.filter((audio) => (audio.audioStatus ? audio.audioStatus === 'generated' : true));
  }, [testAudios]);

  const moduleOptions = React.useMemo(() => {
    return ['all', ...Array.from(new Set(generatedAudios.map((audio) => getDirectoryLabel(audio))))];
  }, [generatedAudios, getDirectoryLabel]);

  const filteredAudios = React.useMemo(() => {
    if (selectedModule === 'all') return generatedAudios;
    return generatedAudios.filter((audio) => getDirectoryLabel(audio) === selectedModule);
  }, [generatedAudios, selectedModule, getDirectoryLabel]);

  const currentPlayingTestId = playback.currentType === 'test' ? playback.currentAudioId : null;

  const { playingId, play } = useAudioPlayer();
  const { selectedIds, toggle, selectAll, remove, clear, isAllSelected } = useSelection();
  const { currentPage, totalPages, pageStart, pageEnd, pageItems, goPage } = usePagination(filteredAudios, PAGE_SIZE);

  const groupedPageItems = React.useMemo(() => {
    return pageItems.reduce((acc, audio) => {
      const moduleName = getDirectoryLabel(audio);
      if (!acc[moduleName]) {
        acc[moduleName] = [];
      }
      acc[moduleName].push(audio);
      return acc;
    }, {});
  }, [pageItems, getDirectoryLabel]);

  React.useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      Object.keys(groupedPageItems).forEach((groupName) => {
        if (next[groupName] === undefined) {
          next[groupName] = true;
        }
      });
      return next;
    });
  }, [groupedPageItems]);

  // 删除音频
  const handleDelete = (id) => {
    dispatch(actions.removeTestAudio(id));
    remove(id);
  };

  // 批量删除
  const handleBatchDelete = () => {
    selectedIds.forEach(id => dispatch(actions.removeTestAudio(id)));
    clear();
  };

  const pageIds = pageItems.map(a => a.id);
  const allPageSelected = isAllSelected(pageIds);

  const toggleGroup = (groupName) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
  };

  return (
    <div className="bg-dark rounded-xl p-6 border border-gray-700">
      {/* 标题栏 */}
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <span className="text-2xl">📋</span>
          测试音频列表
          <span className="text-sm text-gray-400 font-normal">
            ({filteredAudios.length} / {generatedAudios.length} 条可测试)
          </span>
        </h2>

        {selectedIds.size > 0 && (
          <button
            onClick={handleBatchDelete}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded-lg text-sm transition-colors"
          >
            删除选中 ({selectedIds.size})
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center justify-end gap-2">
        <span className="text-sm text-gray-400">功能模块筛选</span>
        <select
          value={selectedModule}
          onChange={(e) => {
            setSelectedModule(e.target.value);
            goPage(1);
          }}
          className="px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white focus:border-primary"
        >
          <option value="all">全部模块</option>
          {moduleOptions
            .filter((moduleName) => moduleName !== 'all')
            .map((moduleName) => (
              <option key={moduleName} value={moduleName}>{moduleName}</option>
            ))}
        </select>
      </div>

      {filteredAudios.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-4">📭</p>
          <p>当前模块暂无测试音频</p>
          <p className="text-sm mt-2">请切换模块，或先在测试用例管理页点击“生成测试音频”</p>
        </div>
      ) : (
        <>
          {/* 列表头部 */}
          <div className="flex items-center gap-3 px-3 py-2 mb-1 border-b border-gray-700 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={() => selectAll(pageIds)}
              className="w-4 h-4 rounded cursor-pointer"
              title="全选当前页"
            />
            <span className="w-6 text-center">#</span>
            <span className="w-8"></span>
            <span className="w-24 text-center hidden md:block">功能模块</span>
            <span className="flex-1">文本内容</span>
            <span className="w-20 text-center hidden sm:block">来源 / 时长</span>
            <span className="w-8 text-center">操作</span>
          </div>

          {/* 列表项 */}
          <div className="space-y-3">
            {Object.entries(groupedPageItems).map(([moduleName, moduleAudios]) => (
              <div key={moduleName} className="border border-gray-700 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleGroup(moduleName)}
                  className="w-full px-3 py-2 bg-gray-800/70 text-xs text-gray-300 flex items-center justify-between hover:bg-gray-700/70 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span>{expandedGroups[moduleName] ? '▾' : '▸'}</span>
                    <span>📁</span>
                    <span className="truncate" title={moduleName}>{moduleName}</span>
                  </span>
                  <span>{moduleAudios.length} 条</span>
                </button>
                {expandedGroups[moduleName] !== false && moduleAudios.map((audio, idx) => {
                  const globalIndex = pageStart + pageItems.findIndex((item) => item.id === audio.id) + 1;
                  const isPlaying = playingId === audio.id;
                  const isRunnerPlaying = currentPlayingTestId === audio.id;
                  const audioDirectory = getDirectoryLabel(audio);

                  return (
                    <div
                      key={audio.id}
                      className={`flex items-center gap-3 px-3 py-2.5 transition-colors border-t border-gray-800 ${
                        isRunnerPlaying
                          ? 'bg-accent/20 ring-1 ring-inset ring-accent/40'
                          : selectedIds.has(audio.id)
                          ? 'bg-primary/15'
                          : 'bg-gray-800/40 hover:bg-gray-700/40'
                      }`}
                    >
                  {/* 复选框 */}
                  <input
                    type="checkbox"
                    checked={selectedIds.has(audio.id)}
                    onChange={() => toggle(audio.id)}
                    className="w-4 h-4 rounded cursor-pointer flex-shrink-0"
                  />

                  {/* 序号 */}
                  <span className="text-gray-500 text-sm w-6 text-center flex-shrink-0">
                    {globalIndex}
                  </span>

                  {/* 播放按钮 */}
                  <button
                    onClick={() => play(audio)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center
                               transition-colors flex-shrink-0 ${
                      isPlaying
                        ? 'bg-primary text-white animate-pulse'
                        : 'bg-gray-600 hover:bg-primary/80 text-white'
                    }`}
                    title={isPlaying ? '停止' : '播放'}
                  >
                    {isPlaying ? '⏹' : '▶'}
                  </button>

                  <div className="hidden md:flex w-24 justify-center flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      isRunnerPlaying
                        ? 'bg-accent/25 text-accent'
                        : 'bg-gray-700 text-gray-300'
                    } max-w-[88px] truncate`} title={audioDirectory}>
                      {audioDirectory}
                    </span>
                  </div>

                  {/* 文本内容 */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${isRunnerPlaying ? 'text-accent font-medium' : 'text-white'}`}>{audio.text}</p>
                    <p className="text-xs text-gray-500 mt-0.5 sm:hidden">
                      {getSourceInfo(audio.source).label} · {formatDuration(audio.duration || 0)}
                    </p>
                  </div>

                  {/* 来源 / 时长 */}
                  <div className="hidden sm:flex flex-col items-center w-20 flex-shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      audio.source === 'tts'
                        ? 'bg-blue-500/20 text-blue-400'
                        : audio.source === 'tapd'
                        ? 'bg-indigo-500/20 text-indigo-300'
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                      {getSourceInfo(audio.source).label}
                    </span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      {formatDuration(audio.duration || 0)}
                    </span>
                  </div>

                  {/* 删除按钮 */}
                  <button
                    onClick={() => handleDelete(audio.id)}
                    className="w-7 h-7 flex items-center justify-center rounded
                               text-red-400 hover:bg-red-500/20 transition-colors text-sm flex-shrink-0"
                    title="删除"
                  >
                    ✕
                  </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 分页控件 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
              <span className="text-xs text-gray-500">
                第 {pageStart + 1}–{Math.min(pageEnd, filteredAudios.length)} 条，共 {filteredAudios.length} 条
              </span>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => goPage(1)}
                  disabled={currentPage === 1}
                  className="w-8 h-8 rounded flex items-center justify-center text-sm
                             disabled:text-gray-600 disabled:cursor-not-allowed
                             text-gray-400 hover:bg-gray-700 transition-colors"
                  title="首页"
                >«</button>

                <button
                  onClick={() => goPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="w-8 h-8 rounded flex items-center justify-center text-sm
                             disabled:text-gray-600 disabled:cursor-not-allowed
                             text-gray-400 hover:bg-gray-700 transition-colors"
                >‹</button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                  .reduce((acc, p, i, arr) => {
                    if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === '...' ? (
                      <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-gray-600 text-sm">…</span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => goPage(item)}
                        className={`w-8 h-8 rounded flex items-center justify-center text-sm transition-colors ${
                          item === currentPage ? 'bg-primary text-white' : 'text-gray-400 hover:bg-gray-700'
                        }`}
                      >{item}</button>
                    )
                  )
                }

                <button
                  onClick={() => goPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="w-8 h-8 rounded flex items-center justify-center text-sm
                             disabled:text-gray-600 disabled:cursor-not-allowed
                             text-gray-400 hover:bg-gray-700 transition-colors"
                >›</button>

                <button
                  onClick={() => goPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="w-8 h-8 rounded flex items-center justify-center text-sm
                             disabled:text-gray-600 disabled:cursor-not-allowed
                             text-gray-400 hover:bg-gray-700 transition-colors"
                  title="末页"
                >»</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
