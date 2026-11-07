export const APP_NAME = "TimeQuest";
export const APP_SUBTITLE = "高考倒计时 · 自习推进器";
export const APP_FULL_NAME = `${APP_NAME} — ${APP_SUBTITLE}`;
export const DB_FILE = "timequest.db";

/** Default next Gaokao: June 7 */
export const DEFAULT_EXAM_DATE = "2027-06-07";

export const ACCENT = "#F97316"; // sprint orange

/** Built-in outlines are AI-generated and may lag the latest exam syllabus. */
export const KNOWLEDGE_POINT_DISCLAIMER =
  "注：内置考点目录仅供参考，请以学校老师要求和最新考纲为准。";

export const NOTE_COLORS = [
  "yellow",
  "orange",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export const SUBJECTS = [
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "历史",
  "地理",
  "政治",
  "其他",
] as const;

export const METHODS = ["听课", "刷题", "整理"] as const;

export const TAG_TYPES = [
  { value: "study", label: "学习" },
  { value: "sport", label: "运动" },
  { value: "game", label: "游戏" },
  { value: "other", label: "其他" },
] as const;

/** Built-in lines for the gamification UI. Not stored until the user picks one. */
export const DEFAULT_MOTIVATIONS = [
  "多考一分，干掉千人",
  "你今天流的汗，都是当初选专业时脑子里进的水",
  "别想了，想也是复读",
  "现在偷的懒，都会计进志愿表",
  "卷不卷是态度，分不分数是事实",
  "书桌前的一小时，顶过床上的一场梦",
  "你不是在做题，你是在给未来的自己腾位置",
  "高考不相信临时抱佛脚，只相信重复",
  "别人刷手机的时候，你多做一道，差距就在这里",
  "痛苦是暂时的，录取通知书上的学校是印上去的",
  "今天不想学，明天的你更不想",
  "把「等会儿」从词库里删掉",
  "分数不会因为你觉得难就给你打折",
  "你歇着的时候，有人正在把你想去的专业名额填上",
  "错题本比鸡汤有用",
  "先做完，再怀疑人生",
  "一模的名次不是判决书，是催更",
  "晚自习的灯还亮着，说明还来得及",
  "别跟困意谈判，它只会赢",
  "这一页写完，比刷十分钟短视频值",
  "考场上没人管你昨天有多累",
  "目标院校不会因为你「差不多」就开门",
  "手比脑子诚实，写下去就对了",
  "今天的计划完成了，才有资格焦虑明天",
] as const;
