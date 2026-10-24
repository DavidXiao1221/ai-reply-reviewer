import type { LightweightReview } from '../lib/reviewSchema';

// Constructed regression materials informed by the user's V3.1 screenshots.
// NOT the original 1,808 / 2,660 / 2,299-character ChatGPT answers, and NOT
// verified statements about markets or these products. Expected outputs below
// are hand-authored parser/UI fixtures, never evidence of live model quality.
const item = (text: string, blockId: string, exactQuote: string) => ({text, evidence: [{blockId, exactQuote}]});
export const lightweightCases: Array<{
  id: string; name: string; origin: string; question: string; answer: string;
  expected: LightweightReview; mustKeep: string[];
}> = [
  {
    id: 'market', name: '全球市场下跌原因', origin: 'synthetic-from-screenshot-topics',
    question: '为什么全球股市和加密市场一起大跌？这是否意味着系统性危机？',
    answer: [
      '本轮股市与加密市场同步下跌，主要解释是AI投资回报预期重估与中东局势推高油价两种冲击叠加。风险偏好下降可能同时压低高估值股票与加密资产，但目前还不能把这轮下跌认定为全球系统性金融危机。这个判断区分了资产价格调整和信用风险跨行业扩散。',
      '行情要分清时间口径：美股是10月22日盘中，亚洲是当日表现，加密行情截至新加坡时间10月23日01:53，并非统一时点。示例数据显示纳指约跌2.21%、费半跌超5%、KOSPI跌3.5%、恒指跌3.0%；BTC约81,314美元，24小时跌3.96%，ETH跌5.32%。这些是各自观察窗口的数据，不宜直接比较跌幅大小。',
      'AI相关公司的资本开支、现金流与融资变化引发了对投资回报的担忧；布伦特原油升至约111—112美元/桶，也增加了通胀与降息受限的担忧。这两项变化直接造成了当天所有风险资产的下跌。本文只列出同步发生的事件，没有给出资金流和事件窗口对照。',
      '指数还受巨型科技股权重影响，并不代表所有股票都跌。AI融资信用风险已有警示信号，是否向其他行业扩散尚不能断言；BTC永续未平仓量下降也不足以认定全市场发生大规模多头强平。区分这些层次，有助于避免从单一指标跳到全市场结论。',
      '后续可观察布伦特是否持续站上110美元、费半是否止跌及AI信用利差是否扩大。不要仅因跌幅大就抄底或用高杠杆抢反弹。观察这些指标只是跟进解释是否持续，不意味着已经确认市场底部，也不构成确定的收益预测。',
    ].join('\n\n'),
    expected: {
      schemaVersion: '3.5',
      brief: {
        conclusion: item('原回答以AI回报预期重估与油价冲击解释同步下跌，尚不能认定为全球系统性危机。','b001','主要解释是AI投资回报预期重估与中东局势推高油价两种冲击叠加'),
        points: [
          item('美股、亚洲及加密行情的观察时点不同，跌幅不宜直接横比。','b002','这些是各自观察窗口的数据，不宜直接比较跌幅大小。'),
          item('AI融资信用风险向其他行业扩散未定；未平仓量下降不足以证明大规模强平。','b004','AI融资信用风险已有警示信号，是否向其他行业扩散尚不能断言；BTC永续未平仓量下降也不足以认定全市场发生大规模多头强平。'),
        ],
        nextStep: item('观察油价、费半与AI信用利差；不要只因跌幅大就抄底或加杠杆。','b005','后续可观察布伦特是否持续站上110美元、费半是否止跌及AI信用利差是否扩大。不要仅因跌幅大就抄底或用高杠杆抢反弹。'),
      },
      assessment: [{kind:'caveat', ...item('从同步事件跳到“直接造成所有风险资产下跌”，因果措辞超出了文中证据。','b003','这两项变化直接造成了当天所有风险资产的下跌。'), followUp:null}],
    },
    mustKeep: ['主要解释而非因果证实','尚非已确认系统性危机','扩散与强平判断边界','不按跌幅抄底或加杠杆'],
  },
  {
    id: 'agent-choice', name: '已有工具是否值得折腾开源Agent', origin: 'synthetic-from-screenshot-topics',
    question: '我已有Codex、Cursor和Dot，还需要同时折腾Pi、Hermes、OpenClaw与DeepSeek Harness吗？',
    answer: [
      '值得研究，但不必把四套开源Agent都安装并投入日常使用。已有Codex、Cursor和Dot覆盖日常交付需求，先用现有工具完成产品和商业验证；学习架构时只选一套做实验，不要把研究新框架变成维护四套工具。工具数量增加本身不代表效率提高。',
      'Pi优先适合学习Agent Loop、工具调用与定制扩展。DeepSeek Harness更偏插件化平台，目前处于开发预览阶段，不作为第一优先。它们可放在同一组理解，不必同时安装；如果只想知道模型怎样连续执行工具，先选Pi就足够形成实验对象。',
      'Hermes的看点是长期记忆和技能积累，可先观察；OpenClaw偏本地执行和多渠道接入，要按需求考虑，部署与权限维护更多。二者是另一组用途，只有你确实需要这些能力时才值得额外投入，不能把每种能力都当成当前项目必须有的功能。',
      'Pi、Hermes、OpenClaw可复用ChatGPT/Codex订阅登录；DeepSeek Harness默认使用API Key，OAuth需要社区插件。但复用登录不等于无限独立额度，免费Gemini Pro也不等于Gemini API额度。应区分账号登录方式、调用计费和模型额度，不能据此推断额外工具免费无限可用。',
      '建议只做一次3—5小时的Pi实验，不增加月度订阅：在独立测试目录，用现有订阅登录，完成读取资料、提炼结论、写入Markdown，再做一个TypeScript扩展。对比同一任务Codex能否更简单完成，无优势就不维护。涉及文件、登录态和凭据时用最小权限，不让Agent操作交易账户或执行不可逆外部动作。',
      '整体优先级是产品交付与商业验证、熟练使用已有工具、学会开发自己的Agent、继续探索新框架。以上比较按功能与用途展开，没有测量安装配置耗时、持续维护时长或同一任务的实际效率差异，因此这些排序仍是定性判断。',
    ].join('\n\n'),
    expected: {
      schemaVersion: '3.5',
      brief: {
        conclusion: item('日常交付沿用现有工具；为学习架构只试一套，无需同时维护四套Agent。','b001','已有Codex、Cursor和Dot覆盖日常交付需求，先用现有工具完成产品和商业验证；学习架构时只选一套做实验'),
        points: [
          item('Pi优先学循环与扩展；DSH仍是开发预览，暂不优先。','b002','Pi优先适合学习Agent Loop、工具调用与定制扩展。DeepSeek Harness更偏插件化平台，目前处于开发预览阶段，不作为第一优先。'),
          item('Hermes先观察记忆与技能；OpenClaw按本地执行及多渠道需求选择，维护更多。','b003','Hermes的看点是长期记忆和技能积累，可先观察；OpenClaw偏本地执行和多渠道接入，要按需求考虑，部署与权限维护更多。'),
          item('复用订阅不等于无限独立额度；实验用隔离目录和最小权限，避免不可逆外部动作。','b005','涉及文件、登录态和凭据时用最小权限，不让Agent操作交易账户或执行不可逆外部动作。'),
        ],
        nextStep: item('给Pi 3—5小时，用同一任务对比Codex；不增订阅，无优势就停止维护。','b005','建议只做一次3—5小时的Pi实验，不增加月度订阅'),
      },
      // The answer already admits the lack of quantitative comparison. Repeating
      // that caveat is not incremental, so this no-finding case must stay empty.
      assessment: [],
    },
    mustKeep: ['生产与学习目的分开','Pi优先、DSH预览、Hermes观察、OpenClaw按需','额度不等同无限','3—5小时且不新增订阅','无优势不维护与权限边界'],
  },
  {
    id: 'pi-definition', name: 'Pi是什么及与Harness比较', origin: 'synthetic-from-screenshot-topics',
    question: 'Pi Agent是什么？和DeepSeek Harness、Codex有什么区别，适合谁？',
    answer: [
      'Pi Agent是极简、开源、可定制的AI编程Agent，也可以作为开发其他Agent的基础框架，即Agent Harness。它的定位是把模型与工具循环做成可扩展的基础，而不是预置一个功能齐全的工作平台。理解它的核心用途，比先安装所有附加功能更重要。',
      '核心工具包括read、write、edit和bash，通过模型与工具循环完成编程、文件处理和自动化脚本。可以用TypeScript扩展定制能力、调用多种模型、在运行中切换模型；提供终端、命令行、JSON/RPC和TypeScript SDK等运行方式，便于嵌入产品。',
      '极简核心不默认提供多Agent编排、Plan Mode和待办系统；Agent可编写扩展修改自身功能。更少默认功能也意味着使用者需要自己选择与组合能力。极简不保证更快或Token更省，要用实际任务判断，不应仅凭架构风格推断成本优势。',
      '与DeepSeek Harness相比，二者都是开放式Harness，但Pi默认功能更少，DSH更平台化。Codex直接完成软件工程任务。若目标是日常提效，已有Codex时额外收益可能不大；若想学习Agent架构或构建自己的工具，Pi值得尝试。这两个目标应分别考虑。',
      'Windows可以使用官方PowerShell安装器，也可以先安装Node.js 22.19+，再通过npm全局安装。需要确认终端能找到Node和npm，安装完成后运行pi，再用/login进入登录步骤。下面继续按下载、终端检查、包安装、首次启动、账号登录、模型切换、路径确认、扩展目录、配置文件和常见报错逐项解释。',
      '安装时先确认Node版本，再确认全局目录和终端PATH一致；遇到找不到命令要重启终端并检查路径。首次运行后选择模型，再检查配置文件保存位置，后续可以添加扩展。软件免费但模型调用可能收费，默认执行工具不逐次确认；初次应在隔离目录运行，勿给敏感文件与真实密钥。以上安装步骤并不证明日常使用会比Codex更省事。',
    ].join('\n\n'),
    expected: {
      schemaVersion: '3.5',
      brief: {
        conclusion: item('Pi是可定制的开源编程Agent及开发框架，适合学习Agent架构或自建工具。','b001','Pi Agent是极简、开源、可定制的AI编程Agent，也可以作为开发其他Agent的基础框架'),
        points: [
          item('以读写、编辑和bash工具循环工作，可用TypeScript扩展或SDK嵌入产品。','b002','核心工具包括read、write、edit和bash，通过模型与工具循环完成编程、文件处理和自动化脚本。'),
          item('Pi比DSH少默认功能；已有Codex时日常增益可能有限，极简不保证更快或更省Token。','b003','极简不保证更快或Token更省，要用实际任务判断'),
          item('软件免费但模型可能收费；工具不逐次确认，初试需隔离目录，勿给敏感文件与真实密钥。','b006','软件免费但模型调用可能收费，默认执行工具不逐次确认；初次应在隔离目录运行，勿给敏感文件与真实密钥。'),
        ],
        nextStep: null,
      },
      assessment: [{kind:'caveat',...item('定义和适用人群已给出，但后半篇安装排错展开偏多，分散了用途比较的重点。','b005','下面继续按下载、终端检查、包安装、首次启动、账号登录、模型切换、路径确认、扩展目录、配置文件和常见报错逐项解释。'),followUp:null}],
    },
    mustKeep: ['定义与核心能力','学习架构与日常提效区分','极简不保证效率或费用','模型收费与执行权限边界','定义题不凭空加行动'],
  },
];
export const lightweightDemoInput = lightweightCases[2]!;
export const lightweightDemo = lightweightDemoInput.expected;
