$ErrorActionPreference = 'Stop'

$templatePath = 'E:\VoiceAuto语音自动化工具汇报.pptx'
$outputPath = 'E:\Voice\VoiceAuto\docs\training\VoiceAuto语音自动化工具培训.pptx'
$previewDir = 'E:\Voice\VoiceAuto\.codex\voiceauto-training-ppt-preview'

New-Item -ItemType Directory -Force -Path (Split-Path $outputPath) | Out-Null
New-Item -ItemType Directory -Force -Path $previewDir | Out-Null

function Set-Text($slide, [string]$shapeName, [string]$text) {
  foreach ($shape in $slide.Shapes) {
    try {
      if ($shape.Name -eq $shapeName) {
        if ($shape.HasTextFrame -ne 0) {
          $shape.TextFrame.TextRange.Text = $text
          return
        }
      }
    } catch {
      continue
    }
  }
}

function Set-AnyText($slide, [string[]]$shapeNames, [string]$text) {
  foreach ($name in $shapeNames) {
    Set-Text $slide $name $text
  }
}

function Insert-TemplateSlide($deck, [int]$sourceIndex) {
  $deck.Slides.InsertFromFile($templatePath, $deck.Slides.Count, $sourceIndex, $sourceIndex) | Out-Null
  return $deck.Slides.Item($deck.Slides.Count)
}

function Fill-Cover($slide) {
  Set-Text $slide '文本框 17' 'VoiceAuto'
  Set-Text $slide '文本框 15' '工具培训'
  Set-Text $slide '文本框 5' '培训对象：测试 / 开发 / 产品'
}

function Fill-StepSlide($slide, [string]$title, [array]$steps, [array]$outcomes) {
  Set-Text $slide 'Text 3' $title
  for ($i = 0; $i -lt 5; $i++) {
    $n = $i + 1
    Set-Text $slide "step-num-text-$n" ('{0:D2}' -f $n)
    Set-Text $slide "step-title-$n" $steps[$i].Title
    Set-Text $slide "step-desc-$n" $steps[$i].Desc
  }
  $keys = @('对测试团队', '对研发定位', '对版本汇报')
  for ($i = 0; $i -lt 3; $i++) {
    Set-Text $slide "outcome-title-$($keys[$i])" $outcomes[$i].Title
    Set-Text $slide "outcome-body-$($keys[$i])" $outcomes[$i].Body
  }
}

function Fill-TwoCardSlide($slide, [string]$title, [string]$subtitle, [array]$cards, [string]$closeText) {
  Set-Text $slide 'Text 3' $title
  Set-Text $slide 'TextBox 7' $subtitle
  Set-Text $slide 'phase-period-近期' $cards[0].Label
  Set-Text $slide 'phase-title-近期' $cards[0].Title
  Set-Text $slide 'phase-points-近期' $cards[0].Body
  Set-Text $slide 'phase-outcome-近期' $cards[0].Outcome
  Set-Text $slide 'phase-period-远期' $cards[1].Label
  Set-Text $slide 'phase-title-远期' $cards[1].Title
  Set-Text $slide 'phase-points-远期' $cards[1].Body
  Set-Text $slide 'phase-outcome-远期' $cards[1].Outcome
  Set-Text $slide 'roadmap-close' $closeText
}

function Fill-ThreeCardSlide($slide, [string]$title, [string]$subtitle, [array]$cards, [string]$closeText) {
  Set-Text $slide 'Text 3' $title
  Set-Text $slide 'TextBox 7' $subtitle
  $keys = @('近期', '中期', '远期')
  for ($i = 0; $i -lt 3; $i++) {
    Set-Text $slide "phase-period-$($keys[$i])" $cards[$i].Label
    Set-Text $slide "phase-title-$($keys[$i])" $cards[$i].Title
    Set-Text $slide "phase-points-$($keys[$i])" $cards[$i].Body
    Set-Text $slide "phase-outcome-$($keys[$i])" $cards[$i].Outcome
  }
  Set-Text $slide 'roadmap-close' $closeText
}

$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = -1
$deck = $ppt.Presentations.Add(-1)

try {
  $slides = @()
  $slides += Insert-TemplateSlide $deck 1
  $slides += Insert-TemplateSlide $deck 2
  $slides += Insert-TemplateSlide $deck 4
  $slides += Insert-TemplateSlide $deck 2
  $slides += Insert-TemplateSlide $deck 4
  $slides += Insert-TemplateSlide $deck 4
  $slides += Insert-TemplateSlide $deck 3
  $slides += Insert-TemplateSlide $deck 4
  $slides += Insert-TemplateSlide $deck 3
  $slides += Insert-TemplateSlide $deck 4
  $slides += Insert-TemplateSlide $deck 4
  $slides += Insert-TemplateSlide $deck 3
  $slides += Insert-TemplateSlide $deck 4
  $slides += Insert-TemplateSlide $deck 5

  Fill-Cover ($deck.Slides.Item(1))

  Fill-StepSlide ($deck.Slides.Item(2)) '01 培训地图：从工具认知到协作闭环' @(
    @{ Title='工具定位'; Desc="语音自动化平台`r覆盖测试全链路" },
    @{ Title='准备数据'; Desc="TAPD / 文本 / 文件`r形成任务池" },
    @{ Title='执行测试'; Desc="唤醒 / ASR / 播报`r批量回归验证" },
    @{ Title='分析证据'; Desc="过程记录 / Langfuse`r定位失败节点" },
    @{ Title='沉淀结论'; Desc="Excel / 报告 / 钉钉`r支撑版本决策" }
  ) @(
    @{ Title='测试会执行'; Body='能独立完成用例导入、音频生成、测试执行与结果导出。' },
    @{ Title='开发会定位'; Body='能基于过程记录、ADB、录音与 Langfuse 快速定位链路问题。' },
    @{ Title='产品会判断'; Body='能读懂覆盖范围、通过率、Agent 命中率与发布风险。' }
  )

  Fill-ThreeCardSlide ($deck.Slides.Item(3)) '02 三类角色的培训重点' '同一套工具服务不同角色：测试跑准流程，开发定位问题，产品判断质量。' @(
    @{ Label='测试'; Title='执行闭环'; Body="• 导入用例并生成音频`r• 配置测试参数和模块`r• 查看过程记录与导出报告"; Outcome='把测试跑准' },
    @{ Label='开发'; Title='链路排查'; Body="• 查看唤醒、ASR、播报节点`r• 结合 ADB 与 Langfuse 日志`r• 排查代理、数据库和配置问题"; Outcome='把异常定位深' },
    @{ Label='产品'; Title='质量判断'; Body="• 关注模块覆盖和失败分布`r• 查看 Agent 命中率和耗时`r• 形成版本风险结论"; Outcome='把结论讲清' }
  ) '培训目标：让测试、开发、产品使用同一套数据口径协作。'

  Fill-StepSlide ($deck.Slides.Item(4)) '03 一次完整语音自动化测试流程' @(
    @{ Title='用例接入'; Desc="TAPD / 文本 / 音频`r进入测试用例管理" },
    @{ Title='音频生成'; Desc="豆包 V3 TTS`r按模块批量准备" },
    @{ Title='测试执行'; Desc="唤醒词 + 测试音频`r循环执行与高亮" },
    @{ Title='过程记录'; Desc="唤醒 / ASR / 播报`r记录证据链" },
    @{ Title='日志报告'; Desc="Langfuse + 总结报告`r输出质量结论" }
  ) @(
    @{ Title='自动化替代重复操作'; Body='减少人工反复播放和手动记录，提升冒烟与回归效率。' },
    @{ Title='全过程可追踪'; Body='每条用例拆分为可查看、可导出、可复核的执行节点。' },
    @{ Title='测试结论可复用'; Body='报告、日志和录音可作为缺陷定位与版本验收依据。' }
  )

  Fill-ThreeCardSlide ($deck.Slides.Item(5)) '04 配置中心：统一维护工具运行参数' '配置保存到数据库；管理员可编辑，普通用户只使用已配置能力。' @(
    @{ Label='配置一'; Title='系统接入'; Body="• TAPD：项目和测试计划导入`r• Langfuse：多环境日志拉取`r• 钉钉：流程通知与告警"; Outcome='减少临时参数不一致' },
    @{ Label='配置二'; Title='语音能力'; Body="• 豆包 TTS：APP ID / Token`r• Resource ID 与音色匹配`r• MiniMax：报告评测配置"; Outcome='保证音频和评测可用' },
    @{ Label='配置三'; Title='权限管理'; Body="• 新增、修改、删除账号`r• 管理员编辑配置参数`r• 统计测试人和测试时长"; Outcome='支撑多人协作使用' }
  ) '配置中心目标：让环境、账号、通知和模型参数有统一可信来源。'

  Fill-ThreeCardSlide ($deck.Slides.Item(6)) '05 用例与音频：把测试计划转成可执行任务' '正式回归优先从 TAPD 导入，临时验证可用文本或手动输入补充。' @(
    @{ Label='入口一'; Title='TAPD 导入'; Body="• 读取配置中心 API 参数`r• 选择项目和开始状态计划`r• 解析 Human 与预期结果"; Outcome='承接正式测试计划' },
    @{ Label='入口二'; Title='文本 / 文件'; Body="• 文本每行一条用例`r• 音频文件直接导入`r• 支持模块归类和筛选"; Outcome='支撑临时验证' },
    @{ Label='入口三'; Title='音频生成'; Body="• 按模块批量生成`r• 失败可重新生成`r• 测试结束后保留继续使用"; Outcome='形成可复用音频池' }
  ) '准备阶段标准：用例内容清楚、模块归类正确、音频可播放。'

  Fill-TwoCardSlide ($deck.Slides.Item(7)) '06 执行测试：固定等待与自主监测两种模式' '根据现场环境选择模式：基础演示可用固定等待，质量验证建议开启自主监测。' @(
    @{ Label='模式一'; Title='固定等待'; Body="• 唤醒词后按延迟播放测试音频`r• 适合快速冒烟和基础演示`r• 对设备日志依赖较低"; Outcome='快速开始测试' },
    @{ Label='模式二'; Title='自主监测'; Body="• ADB 判断唤醒和 ASR 输入`r• 麦克风录制 Speaker 播报`r• 过程记录展示文本相似度和录音"; Outcome='自动判断链路状态' }
  ) '执行重点：先小批量试跑，确认链路稳定后再做全量回归。'

  Fill-ThreeCardSlide ($deck.Slides.Item(8)) '07 过程记录：把失败定位到具体链路' '过程记录是测试、开发、产品共同使用的事实来源。' @(
    @{ Label='节点一'; Title='唤醒'; Body="• 查看 Speaker 是否被唤醒`r• 连续失败可触发恢复`r• 关注设备在线和 logcat"; Outcome='定位入口问题' },
    @{ Label='节点二'; Title='ASR'; Body="• 查看实际识别文本`r• 对比测试音频文本`r• 判断输入是否进入系统"; Outcome='定位识别问题' },
    @{ Label='节点三'; Title='播报'; Body="• 保存 Speaker 播报录音`r• 展示收录文本和相似度`r• 识别无回复是否符合预期"; Outcome='定位回复问题' }
  ) '判定口径：预期结果写明“回复可有可无”时，无回复不算错误。'

  Fill-TwoCardSlide ($deck.Slides.Item(9)) '08 Langfuse 与总结报告：从日志到版本结论' '测试完成后可自动停留 2 分钟再跳转 Langfuse，降低日志延迟导致的漏数。' @(
    @{ Label='日志'; Title='Langfuse 拉取'; Body="• 按 UAT / TEST / PROD 环境拉取`r• 自动分页 Traces 和 Observations`r• 支持 familyid / deviceid 筛选"; Outcome='回收服务侧证据' },
    @{ Label='报告'; Title='总结输出'; Body="• 统计模块、通过率和 Agent 命中率`r• 汇总错误信息和重点数据`r• 导出 Markdown / HTML / Excel"; Outcome='形成质量结论' }
  ) '报告重点：只统计本次实际执行音频，避免未执行用例干扰结论。'

  Fill-ThreeCardSlide ($deck.Slides.Item(10)) '09 钉钉通知：让关键节点被团队看见' '钉钉只发送关键状态和关键异常，ASR/TTS 普通错误不刷群。' @(
    @{ Label='前提'; Title='启用条件'; Body="• 配置中心保存机器人参数`r• 语音测试页打开通知开关`r• 生产代理 /dingtalk-robot 可用"; Outcome='确保消息可达' },
    @{ Label='状态'; Title='流程通知'; Body="• 开始执行语音测试`r• 测试暂停、重置`r• 语音测试完成"; Outcome='同步测试进度' },
    @{ Label='异常'; Title='关键告警'; Body="• 唤醒连续失败`r• 音箱重启失败`r• Langfuse 拉取失败或任务中断"; Outcome='推动及时介入' }
  ) '协作口径：群消息提醒关注，问题定位仍以过程记录和日志为准。'

  Fill-ThreeCardSlide ($deck.Slides.Item(11)) '10 常见问题与快速处理' '培训现场优先掌握高频问题，减少第一次使用的阻塞。' @(
    @{ Label='问题一'; Title='日志返回 HTML'; Body="• 说明代理没有命中 Langfuse`r• 检查 /langfuse-api-* 前缀`r• 检查环境 Key 和生产代理"; Outcome='修正代理或配置' },
    @{ Label='问题二'; Title='通知未到群'; Body="• 检查通知开关是否开启`r• 检查 Webhook / Token / Secret`r• ASR/TTS 普通错误不会发送"; Outcome='确认发送条件' },
    @{ Label='问题三'; Title='监听链路异常'; Body="• 检查 adb devices 是否 online`r• 重新自检或一键恢复`r• 确认麦克风权限和输入源"; Outcome='恢复监测能力' }
  ) '排查顺序：先看页面提示，再看过程记录，最后看服务配置和外部日志。'

  Fill-TwoCardSlide ($deck.Slides.Item(12)) '11 疑问解答：统一口径后再进入实操' '建议围绕真实测试场景提问，优先讨论会影响执行和结论的问题。' @(
    @{ Label='问题池'; Title='现场 Q&A'; Body="• 用例导入和预期结果怎么写`r• 无回复场景如何判定`r• 哪些异常需要开发介入`r• 报告如何支撑版本准入"; Outcome='消除使用疑问' },
    @{ Label='共识'; Title='口径确认'; Body="• 测试范围和模块命名`r• 失败判定和复测规则`r• 日志、录音、报告留档要求`r• 钉钉通知响应人"; Outcome='形成团队约定' }
  ) '互动目标：让问题在培训现场被澄清，避免落到执行时才返工。'

  Fill-ThreeCardSlide ($deck.Slides.Item(13)) '12 意见收集：把工具迭代变成团队共建' '培训结束前收集真实使用反馈，按价值和成本进入后续迭代。' @(
    @{ Label='方向一'; Title='流程效率'; Body="• 哪些步骤仍然耗时`r• 批量操作是否足够顺手`r• 是否需要任务模板"; Outcome='优化测试准备和执行' },
    @{ Label='方向二'; Title='结果可信'; Body="• 判定口径是否清晰`r• 报告指标是否够用`r• 是否需要历史对比"; Outcome='提升质量结论可信度' },
    @{ Label='方向三'; Title='协作闭环'; Body="• 钉钉通知是否够精准`r• Bug 提交字段是否完整`r• 产品汇报材料是否好用"; Outcome='完善跨角色协作' }
  ) '收集方式：按角色记录问题、建议、优先级和期望上线时间。'

  Set-Text $deck.Slides.Item(14) '文本框 7' '培训结束'
  Set-Text $deck.Slides.Item(14) '文本框 11' 'Q&A and feedback are welcome'
  Set-Text $deck.Slides.Item(14) '文本框 4' 'VoiceAuto'

  $deck.SaveAs($outputPath, 24)

  Get-ChildItem $previewDir -Filter '*.png' -ErrorAction SilentlyContinue | Remove-Item -Force
  for ($i = 1; $i -le $deck.Slides.Count; $i++) {
    $deck.Slides.Item($i).Export((Join-Path $previewDir ("slide-{0:D2}.png" -f $i)), 'PNG', 1280, 720)
  }

  "output=$outputPath"
  "slides=$($deck.Slides.Count)"
  "preview=$previewDir"
} finally {
  if ($deck) { $deck.Close() }
  if ($ppt) { $ppt.Quit() }
}
