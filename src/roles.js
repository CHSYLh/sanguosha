/**
 * 身份系统：根据房间人数自动配置各身份数量
 */

const ROLE_CN = { lord: '主公', loyal: '忠臣', rebel: '反贼', rene: '内奸' };
const ROLE_COLOR = { lord: '#f0c419', loyal: '#4aa3ff', rebel: '#e5484d', rene: '#8e5cf6' };

/** 各人数下的身份配置表（官方标准局配置） */
const ROLE_CONFIG = {
  2: ['lord', 'rebel'],
  3: ['lord', 'loyal', 'rebel'],
  4: ['lord', 'loyal', 'rebel', 'rene'],
  5: ['lord', 'loyal', 'rebel', 'rebel', 'rene'],
  6: ['lord', 'loyal', 'rebel', 'rebel', 'rebel', 'rene'],
  7: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rene'],
  8: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'rene'],
  9: ['lord', 'loyal', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'rene'],
  10: ['lord', 'loyal', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'rene', 'rene'],
};

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

function rolesFor(count) {
  const cfg = ROLE_CONFIG[count];
  if (!cfg) throw new Error(`不支持 ${count} 人局，人数需在 ${MIN_PLAYERS}~${MAX_PLAYERS} 之间`);
  return cfg.slice();
}

/** 统计某人数下各身份数量 */
function roleSummary(count) {
  const roles = rolesFor(count);
  const summary = { lord: 0, loyal: 0, rebel: 0, rene: 0 };
  for (const r of roles) summary[r]++;
  return summary;
}

/** 身份任务说明 */
const ROLE_GOAL = {
  lord: '消灭所有反贼与内奸',
  loyal: '保护主公，消灭所有反贼与内奸',
  rebel: '杀死主公',
  rene: '先消灭反贼与忠臣，最后与主公单挑取胜',
};

module.exports = { ROLE_CN, ROLE_COLOR, ROLE_CONFIG, ROLE_GOAL, MIN_PLAYERS, MAX_PLAYERS, rolesFor, roleSummary };
