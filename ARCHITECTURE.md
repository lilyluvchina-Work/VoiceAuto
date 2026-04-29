# VoiceAuto 项目架构说明

## 目录结构

```
src/
├── modules/                    # 功能模块（按业务域组织）
│   ├── langfuse/              # Langfuse 日志获取和导出
│   │   ├── services/          # API 服务层
│   │   │   └── langfuseService.js
│   │   ├── utils/             # 数据处理层
│   │   │   ├── sessionExtractor.js    # 日志 session 提取
│   │   │   └── excelExporter.js       # Excel 导出
│   │   ├── components/        # UI 组件（暂未迁移）
│   │   └── index.js           # 模块导出入口
│   │
│   ├── audio/                 # 音频管理
│   │   ├── utils/
│   │   │   ├── audioHelpers.js
│   │   │   └── audioUtils.jsx
│   │   ├── components/        # AudioImporter, AudioList, PlaybackConsole
│   │   └── index.js
│   │
│   ├── test/                  # 测试执行
│   │   ├── utils/
│   │   │   └── reportGenerator.js
│   │   ├── components/        # TestReport
│   │   ├── hooks/             # useTestRunner（可选迁移）
│   │   └── index.js
│   │
│   ├── log/                   # 日志分析
│   │   ├── utils/
│   │   │   └── logAnalysis.js
│   │   ├── components/        # LogAnalyzer
│   │   └── index.js
│   │
│   └── config/                # 配置管理
│       ├── utils/
│       │   └── formatters.js
│       ├── components/        # VoiceConfig, WakeWordConfig
│       └── index.js
│
├── common/                    # 公共工具
│   └── utils/
│       └── fileHelpers.js
│
├── hooks/                     # 全局通用 Hooks（被多个模块使用）
│   ├── useAudioPlayer.js
│   ├── usePagination.js
│   ├── useSelection.js
│   └── useTestRunner.js
│
├── components/               # 共享 UI 组件（暂保持原位置）
├── services/                 # 共享服务（必要时可删除）
├── stores/                   # 全局状态管理
├── constants/                # 全局常量
│
├── App.jsx
├── main.jsx
└── index.css
```

## 架构原则

### 1. **模块隔离**
- 功能按业务域组织在 `modules/` 下
- 每个模块有独立的 `services/`、`utils/`、`components/` 目录
- 模块之间通过公共导出接口 (`index.js`) 通信

### 2. **分层设计**
- **Services**: 数据获取和 API 调用
- **Utils**: 业务逻辑和数据处理
- **Components**: UI 展示层
- **Hooks**: 可复用的状态逻辑

### 3. **文件迁移策略**
- 已迁移：
  - `src/services/langfuseService.js` → `src/modules/langfuse/services/langfuseService.js`
  - `src/utils/excelExport.js` → `src/modules/langfuse/utils/sessionExtractor.js` + `excelExporter.js`
  
- 待迁移（按需）：
  - 音频相关文件 → `modules/audio/`
  - 测试相关文件 → `modules/test/`
  - 日志分析文件 → `modules/log/`
  - 配置文件 → `modules/config/`

### 4. **导入路径更新**
从原来的：
```javascript
import { fetchTraces } from '../services/langfuseService';
import { exportToExcel } from '../utils/excelExport';
```

改为：
```javascript
import { fetchTraces, exportToExcel } from '../modules/langfuse';
```

## 后续优化方向

1. **懒加载模块**：在路由层实现代码分割，按需加载模块
2. **类型定义**：为每个模块添加 `types.js` 定义 TypeScript/JSDoc 类型
3. **测试结构**：为每个模块添加对应的 `__tests__/` 目录
4. **文档**：为每个模块添加 `README.md` 说明 API 和使用方式
5. **共享组件库**：将通用 UI 组件提取到 `components/common/` 或单独库

## 开发规范

1. 模块内的文件相互引用使用相对路径
2. 跨模块引用统一使用模块导出入口 (`index.js`)
3. 新增功能应优先放入对应的模块，避免散落在全局
4. 定期审视 `common/` 和 `hooks/` 目录，移除未使用的代码
