// Copyright (c) 2026 chthollyphile
// src/packs/lumiere/styleNotes.ts
// 绘光 100 个光位的画面描述与检索关键词（给 AI 编排与 agent 的 list_styles 看）。光束、线稿与适合的段落
// 按 rigs/*.ts 的数据手写；排版、文字区位置、十字爆闪由 profile 自动生成，改光位数据时描述跟着走。
import type { ComponentSlotDef, StyleDef } from '@/packs/contract';
import { LUMIERE_FAMILY_LABELS } from './catalog';
import type { WindowTypography } from './text/lyricWindow';
import type { LumiereProfile } from './types';

interface StyleNote {
    /** 看得到的画面：光从哪来、几束、什么颜色形态、线稿画了什么。 */
    scene: string;
    /** 适合的段落。 */
    fit: string;
    keywords: string[];
}

const NOTES: Record<string, StyleNote> = {
    // ── 天光（顶光） ──
    'zenith-shaft': { scene: '正上方一道窄光柱直落，外围两层淡放射光扇，烟在光里上升；顶上量角器光环，四周取景框', fit: '通用，主歌副歌都行', keywords: ['顶光', '光柱', '光环', '取景框'] },
    'zenith-fan': { scene: '顶部光源散出五道细光束成扇形，缓慢张合，光雨较密', fit: '适合副歌与上扬', keywords: ['扇形光束', '放射', '顶光', '多光束'] },
    'zenith-halo': { scene: '正上方光柱加宽光扇，光源眩光很大，顶上一大一小两圈量角器光环像圣环', fit: '适合抒情段落', keywords: ['圣环', '光环', '眩光', '顶光'] },
    'zenith-drift': { scene: '一道顶光柱左右大幅摆动，像探照一样扫过字行，扫到的字变亮', fit: '适合主歌', keywords: ['摆动光柱', '扫光', '顶光', '游移'] },
    'zenith-twin': { scene: '左右两道平行顶光柱缓慢相向摆动，字夹在两柱之间，无光源眩光', fit: '适合主歌与对唱', keywords: ['双光柱', '平行光', '对称', '顶光'] },
    'zenith-rain': { scene: '六道极细的竖直光线像雨一样从顶落下、各自明灭，光雨很密', fit: '适合副歌与快节奏', keywords: ['光雨', '细光线', '竖线', '闪烁'] },
    'zenith-well': { scene: '一道很窄的光柱落到字下方的椭圆光斑上（两圈椭圆线稿），四周几乎全暗', fit: '适合独白与安静段落', keywords: ['光井', '光斑', '窄光', '暗场'] },
    'zenith-crown': { scene: '天井式顶光柱加更大的光源眩光，光偏橙红，镜头推近更多', fit: '适合副歌与高潮', keywords: ['冠冕', '眩光', '橙红', '顶光'] },
    'zenith-descent': { scene: '每个镜头开头约三秒，光柱从顶上往下伸长，碰到字才把字点亮', fit: '适合段落开头与蓄力', keywords: ['垂降', '光柱伸长', '点亮', '顶光'] },
    'zenith-ember': { scene: '将熄的暗橙光柱微微明灭，浓烟里满是往上飘的火星', fit: '适合尾声与间奏', keywords: ['余烬', '火星', '暗橙', '将熄'] },

    // ── 窗隙（窗光与窗影） ──
    'lattice-blinds': { scene: '左上窗口斜射进一道宽光，被百叶切成一条条平行光带；左上角画百叶窗线稿', fit: '适合主歌，日常、室内感', keywords: ['百叶窗', '条纹光', '斜光', '室内'] },
    'lattice-cross': { scene: '右上十字窗斜照下一道宽光，窗棂影子把光分成四块（十字指窗棂，不是十字图形）', fit: '适合安静的回忆段落', keywords: ['十字窗', '窗棂影', '斜光', '回忆'] },
    'lattice-arch': { scene: '左上高处的拱窗斜照下一道又亮又长的丁达尔光束，外围淡光晕；画拱窗线稿', fit: '适合副歌，庄严感', keywords: ['拱窗', '丁达尔', '斜光束', '教堂'] },
    'lattice-rose': { scene: '画面顶部一扇圆形玫瑰花窗线稿，向下放射出六道细光束', fit: '适合副歌', keywords: ['玫瑰窗', '花窗', '放射光束', '教堂'] },
    'lattice-slit': { scene: '左边画一道门缝，极窄的光几乎水平地横穿整个画面，四周很暗', fit: '适合安静段落与独白', keywords: ['门缝', '横光', '细光', '暗场'] },
    'lattice-shoji': { scene: '左侧方格纸窗透进柔和的宽漫射光，带细细的窗格影子，没有眩光', fit: '适合温柔的主歌', keywords: ['障子', '纸窗', '漫射光', '日式'] },
    'lattice-grille': { scene: '左上斜射的宽光被菱形格栅切成菱格光影，光影在字上流动；左上画格栅线稿', fit: '适合主歌', keywords: ['格栅', '菱格', '窗影', '斜光'] },
    'lattice-sweep': { scene: '左上的窗光来回大幅摆动，百叶光带随之扫过整句字', fit: '适合主歌到副歌的过渡', keywords: ['扫光', '百叶', '摆动', '窗光'] },
    'lattice-komorebi': { scene: '两道从树冠漏下的斜光，光斑斑驳、随风晃动；顶部画树冠枝叶线稿', fit: '适合安静段落，夏日回忆', keywords: ['叶隙光', '斑驳', '树影', '夏日'] },
    'lattice-nave': { scene: '顶上一排四扇高窗照下四道平行的斜光束，烟雾层层', fit: '适合副歌，宏大感', keywords: ['殿堂', '平行斜光', '高窗', '宏大'] },

    // ── 棱镜（色散） ──
    'prism-split': { scene: '一束白光从左射入三棱镜线稿，向右下出射成一扇彩虹光谱', fit: '适合副歌', keywords: ['三棱镜', '分光', '彩虹', '光谱'] },
    'prism-band': { scene: '一条宽的彩虹光谱带从左往右斜贯画面，字压在带上', fit: '适合主歌到副歌', keywords: ['光谱带', '彩虹', '横贯', '色散'] },
    'prism-fringe': { scene: '顶光柱与光扇的边缘带一点淡彩虹色散边，其余同天井（光环与取景框）', fit: '适合安静段落', keywords: ['彩边', '顶光', '淡彩', '色散'] },
    'prism-shard': { scene: '画面里散落八块晶片线稿，五道短的彩色光谱束朝各方向射出、缓慢摆动', fit: '适合副歌与高能段落', keywords: ['碎晶', '晶片', '彩色光束', '散射'] },
    'prism-lines': { scene: '红黄绿蓝紫五条竖直细谱线从顶落下，底部画一排光谱刻线，像发射光谱', fit: '适合安静段落', keywords: ['谱线', '彩色竖线', '光谱', '科学'] },
    'prism-merge': { scene: '红、绿、蓝三束细光从左侧汇到小棱镜处，合成一道白光向右射出', fit: '通用，合唱、汇合感', keywords: ['合光', 'RGB', '三色光', '汇聚'] },
    'prism-cube': { scene: '一束光从左射进立方分光镜线稿，一路直行向右、一路折向正下，带淡彩', fit: '适合主歌', keywords: ['分光镜', '直角光路', '分束', '光学'] },
    'prism-wheel': { scene: '顶部小棱镜散出三道宽彩虹光扇，绕光源大幅缓慢转动', fit: '适合副歌与上扬', keywords: ['虹扇', '彩虹', '旋转', '光扇'] },
    'prism-droplet': { scene: '画面底下一道淡彩虹光往上散开，画出主虹与副虹两条大弧，开场光雨密', fit: '适合安静段落，雨后感', keywords: ['彩虹', '虹霓', '雨后', '弧线'] },
    'prism-sweep': { scene: '一道彩虹色的顶光柱左右大幅摆动，像扫描一样扫过字行', fit: '通用', keywords: ['扫描', '彩虹光柱', '摆动', '色散'] },

    // ── 焦散 ──
    'caustic-pool': { scene: '柔和的宽顶光落进水里，光柱中是流动的焦散光网，底部一片椭圆焦散光斑', fit: '适合安静段落', keywords: ['池底', '水光', '焦散', '流动'] },
    'caustic-cup': { scene: '一道侧光从左穿过玻璃杯线稿，桌面上投下一小片很亮的焦散', fit: '适合主歌，日常静物感', keywords: ['玻璃杯', '杯影', '焦散', '静物'] },
    'caustic-ripple': { scene: '柔和顶光里有晃动的焦散网，底部画一圈圈同心涟漪线', fit: '通用', keywords: ['涟漪', '水波', '焦散', '同心圆'] },
    'caustic-surface': { scene: '从水下仰望：顶部一条波动的水面线与光斑，四道斜光束带着焦散射下，浮尘多', fit: '适合副歌', keywords: ['水下', '水面', '斜光束', '焦散'] },
    'caustic-ring': { scene: '中央一个大圆环线稿，焦散光斑落在环内，上方一道窄顶光', fit: '适合安静段落', keywords: ['圆环', '戒指', '焦散', '环形'] },
    'caustic-burn': { scene: '顶部放大镜线稿把光会聚成沙漏形，焦点亮斑正落在下方的字上', fit: '适合副歌与重点句', keywords: ['放大镜', '聚焦', '焦点', '会聚'] },
    'caustic-shimmer': { scene: '一道宽光从左横射，被切成快速闪动的横向水面反光条纹，底部画水面线', fit: '通用', keywords: ['波光粼粼', '反光条纹', '水面', '闪烁'] },
    'caustic-crystal': { scene: '上方一块水晶线稿放射出五道带彩边的细光，底部一片焦散光斑', fit: '通用', keywords: ['水晶', '放射', '彩边', '焦散'] },
    'caustic-drift': { scene: '很宽很柔的顶光里，大块焦散光斑极慢地漂移，几乎静止，线稿只有闪点', fit: '适合间奏与安静段落', keywords: ['漂流', '缓慢', '焦散', '柔光'] },
    'caustic-storm': { scene: '顶光随拍子明灭，焦散快速闪烁翻涌，底部画涟漪线', fit: '适合高能段落与鼓点', keywords: ['骤光', '闪烁', '焦散', '节拍'] },

    // ── 光路（光学图解） ──
    'optics-convex': { scene: '三条平行细光线从左射向凸透镜，会聚到右侧焦点再散开；画透镜、光路与焦点标记', fit: '通用，理性感', keywords: ['凸透镜', '会聚', '焦点', '光路图'] },
    'optics-concave': { scene: '三条平行光线穿过凹透镜后向外散开，虚线反向延长到透镜前的虚焦点', fit: '适合安静段落', keywords: ['凹透镜', '发散', '虚焦点', '光路图'] },
    'optics-mirror': { scene: '一道光从左上斜射到下方的平面镜，再反射到右上，呈 V 形；画镜面与光路', fit: '适合安静段落', keywords: ['平面镜', '反射', 'V形光路', '镜面'] },
    'optics-refract': { scene: '一道光从左上斜射到中间的水平界面，偏折后继续向下，另有淡反射光；画界面与虚线法线', fit: '通用', keywords: ['折射', '界面', '法线', '光路图'] },
    'optics-bench': { scene: '一束水平光依次穿过三片透镜，下方一条刻度尺，像光学实验台', fit: '通用，实验记录感', keywords: ['光具座', '透镜组', '刻度尺', '实验'] },
    'optics-periscope': { scene: '光从右上水平射入，经左侧上下两面 45° 镜子折返，从右下射出；画镜子与光路', fit: '通用', keywords: ['潜望镜', '折返', '镜子', '光路图'] },
    'optics-fiber': { scene: '一条从左下弯到右上的光纤线稿，右上端喷出一锥明亮的光并微微脉动', fit: '适合副歌', keywords: ['光纤', '光锥', '曲线', '喷射'] },
    'optics-pinhole': { scene: '一大束光从左收拢穿过小孔，进入右侧暗箱后再散开，画暗箱与倒立的像', fit: '适合安静段落', keywords: ['小孔成像', '暗箱', '会聚', '倒像'] },
    'optics-telescope': { scene: '两条平行光经大物镜会聚到焦点，再经小目镜变成更窄的平行光射出', fit: '适合副歌', keywords: ['望远镜', '物镜', '目镜', '光路图'] },
    'optics-raytrace': { scene: '几条光线在画面上半部折来折去，连成一张随机的光路网', fit: '适合高能段落', keywords: ['光线追迹', '折线', '光路网', '随机'] },

    // ── 衍射（干涉与衍射） ──
    'wave-slits': { scene: '顶光穿过挡板上的两道缝，下方屏幕框里亮起明暗相间的干涉条纹', fit: '通用', keywords: ['双缝', '干涉条纹', '挡板', '实验'] },
    'wave-newton': { scene: '画面中央一圈圈明暗相间的同心光环缓缓流动，字在环心', fit: '适合安静段落', keywords: ['牛顿环', '同心环', '干涉', '环形'] },
    'wave-airy': { scene: '一根细光落在画面上方一点，形成中心亮斑与几圈淡淡的外环', fit: '适合安静段落', keywords: ['艾里斑', '亮斑', '衍射环', '点光'] },
    'wave-grating': { scene: '一束光从顶打到上方的光栅线稿，向下分出五级衍射光，两侧几级带彩边', fit: '通用', keywords: ['光栅', '衍射', '多束光', '彩边'] },
    'wave-sources': { scene: '两个点源的圆波在画面中央相互干涉，亮暗的双曲线条纹快速流动', fit: '适合副歌', keywords: ['波干涉', '圆波', '双曲线', '条纹'] },
    'wave-moire': { scene: '两层错开一点角度的细条纹光叠在一起，形成缓慢流动的莫尔纹', fit: '通用，迷幻感', keywords: ['莫尔纹', '条纹', '叠影', '迷幻'] },
    'wave-film': { scene: '像肥皂泡一样流动的彩虹色光，上方画一个大圆泡和一个小泡', fit: '适合安静段落', keywords: ['肥皂泡', '虹彩', '薄膜', '梦幻'] },
    'wave-polar': { scene: '一道光从左水平穿过两片偏振片，第二片之后的光一明一暗地呼吸', fit: '通用', keywords: ['偏振', '呼吸', '明暗', '横光'] },
    'wave-standing': { scene: '字行上方三条横贯画面的细光线随节拍一起振动，画驻波曲线', fit: '适合高能段落与强节拍', keywords: ['驻波', '振动', '横线', '节拍'] },
    'wave-holo': { scene: '细密的斜菱格纹加流动虹彩，叠在中央一块网格面板上，像全息片', fit: '适合副歌，科技感', keywords: ['全息', '虹彩', '网格', '科技'] },

    // ── 叶脉（光合） ──
    'botany-sprout': { scene: '正上方一道光柱落在底部一株嫩芽线稿上，淡量角器光环与取景框', fit: '适合开场与安静段落', keywords: ['嫩芽', '萌芽', '顶光', '生长'] },
    'botany-veins': { scene: '一片大叶线稿斜在画面中上部，叶脉被左上斜光一段段点亮', fit: '通用', keywords: ['叶脉', '大叶', '斜光', '植物'] },
    'botany-canopy': { scene: '仰视树冠线稿，三道斜光带着斑驳叶影从叶间射下，浮尘多', fit: '适合副歌', keywords: ['林冠', '树冠', '叶影', '森林'] },
    'botany-fern': { scene: '画面左侧一枝卷曲的蕨叶线稿立在光柱里，随唱缓缓展开', fit: '通用', keywords: ['蕨叶', '卷曲', '展开', '植物'] },
    'botany-seed': { scene: '一道窄光落在下方一粒种子上，根须线稿往下长', fit: '适合安静段落与开场', keywords: ['种子', '根须', '窄光', '生长'] },
    'botany-bloom': { scene: '中央一个光点向六方放射短光束，花瓣线稿一片片打开', fit: '适合副歌', keywords: ['绽放', '花瓣', '放射', '花'] },
    'botany-vine': { scene: '右侧一道光柱，藤蔓线稿从底部螺旋着向上攀升', fit: '通用，上扬感', keywords: ['藤蔓', '螺旋', '攀升', '植物'] },
    'botany-chloro': { scene: '显微镜视野：中央圆形区域里二十多个叶绿体小圆点在柔光与焦散中发亮', fit: '适合安静段落', keywords: ['显微镜', '细胞', '叶绿体', '圆点'] },
    'botany-formula': { scene: '标准顶光柱与光扇，左上与右下各一个分子结构线稿，顶上量角器光环', fit: '通用', keywords: ['分子式', '化学', '顶光', '线稿'] },
    'botany-pollen': { scene: '左上一道宽斜光，光里漂着大量大颗花粉粒，几乎没有线稿', fit: '适合副歌，明亮温暖', keywords: ['花粉', '粒子', '斜光', '春天'] },

    // ── 星象 ──
    'astral-eclipse': { scene: '上方一个黑色圆盘，周围放射六道日冕光，边上一颗亮点（贝利珠），满天星', fit: '适合副歌与高潮', keywords: ['日食', '黑盘', '日冕', '星空'] },
    'astral-orbit': { scene: '中上部四圈倾斜的同心椭圆轨道线稿，行星光点在上面，中心一个小光源', fit: '适合安静段落', keywords: ['轨道', '行星', '椭圆', '星空'] },
    'astral-trail': { scene: '右上天极周围一圈圈同心星轨线稿缓慢旋转，光很暗', fit: '适合间奏与安静段落', keywords: ['星轨', '同心圆', '夜空', '旋转'] },
    'astral-sextant': { scene: '中上部一个六分仪线稿（刻度弧与两条半径），右上一道斜光像太阳的视线', fit: '通用', keywords: ['六分仪', '刻度弧', '航海', '斜光'] },
    'astral-constellation': { scene: '上方与右下各一组星点连成的星座线，只有很淡的顶光', fit: '通用', keywords: ['星座', '连线', '星点', '夜空'] },
    'astral-corona': { scene: '画面上方一个太阳圆盘，边缘放射六道长冕光，眩光很强', fit: '适合副歌与高潮', keywords: ['日冕', '太阳', '放射', '眩光'] },
    'astral-moon': { scene: '右上角一弯新月，冷蓝色的光斜照下来，雾气浓而流动', fit: '适合安静的夜晚段落', keywords: ['新月', '月光', '冷色', '夜晚'] },
    'astral-nebula': { scene: '大片浓烟带柔和彩色，两道宽光从中央往两侧透出，像星云', fit: '通用，辽阔感', keywords: ['星云', '彩色烟雾', '宇宙', '辽阔'] },
    'astral-armillary': { scene: '中央浑天仪的几个圆环线稿缓慢转动，背后一道顶光柱', fit: '通用', keywords: ['浑天仪', '圆环', '旋转', '古典'] },
    'astral-meteor': { scene: '三道细光从右上斜划向左下并明灭，另有六道流星线稿拖尾，满天星', fit: '适合副歌', keywords: ['流星', '斜线', '拖尾', '星空'] },

    // ── 追光（舞台） ──
    'stage-spot': { scene: '左上一盏舞台灯（画灯头）打出一束追光，斜落在中央的字上，浓烟', fit: '适合主歌与独唱', keywords: ['追光', '聚光灯', '单灯', '舞台'] },
    'stage-cross': { scene: '左上、右上两盏舞台灯各打一束追光，斜着交汇在中央的字上（交叉的是两道光束，不是十字架），浓烟', fit: '适合副歌', keywords: ['交叉光束', '双追光', '聚光灯', '舞台'] },
    'stage-search': { scene: '画面底边四盏探照灯向上打光，在浓烟里左右大幅来回扫', fit: '适合副歌与高能段落', keywords: ['探照灯', '扫光', '仰射', '演唱会'] },
    'stage-footlight': { scene: '台口底部三盏暖橙色宽光自下而上照，烟往上飘', fit: '适合安静段落与尾声', keywords: ['脚光', '暖光', '仰光', '台口'] },
    'stage-backlight': { scene: '字的正后方一团强光，六道光束从中心向四周放射，字像剪影', fit: '通用，登场感', keywords: ['逆光', '剪影', '放射', '背光'] },
    'stage-pinspot': { scene: '正上方一盏灯打出极窄的光锥，只照亮中央字那一小块，四周很暗', fit: '适合独白与安静段落', keywords: ['针光', '窄光锥', '独白', '暗场'] },
    'stage-strobe': { scene: '顶部四盏灯斜打向中央，随节拍快速一明一灭地频闪', fit: '适合高能段落与强节拍', keywords: ['频闪', '闪烁', '多灯', '演唱会'] },
    'stage-curtain': { scene: '两侧画帷幕线稿，中间缝隙透出一道竖直细光，字竖在窄窄的光里', fit: '适合开场与安静段落', keywords: ['帷幕', '幕缝', '竖光', '开场'] },
    'stage-laser': { scene: '台底中央射出六道极细锐的激光线，扇形在浓烟里快速扫动', fit: '适合副歌与电子感段落', keywords: ['激光', '扇形', '扫动', '演唱会'] },
    'stage-projector': { scene: '左边一台放映机线稿，射出向右展开的光锥，光里满是浮尘并轻微闪烁', fit: '适合回忆与叙事段落', keywords: ['放映机', '光锥', '胶片', '怀旧'] },

    // ── 萤尘（粒子为主） ──
    'motes-dust': { scene: '暗室里左上一道斜光，光里大量细尘缓缓旋转，线稿只有闪点', fit: '适合安静段落与间奏', keywords: ['浮尘', '斜光', '暗室', '粒子'] },
    'motes-firefly': { scene: '几乎没有光束，只有散落的萤光点自己忽明忽暗，前景也有虚化光点', fit: '适合间奏与安静段落', keywords: ['萤火', '光点', '夜晚', '无光束'] },
    'motes-smoke': { scene: '浓烟一缕缕上升打卷，被左侧低位的侧光勾出轮廓', fit: '通用，间奏', keywords: ['烟缕', '浓烟', '侧光', '朦胧'] },
    'motes-embers': { scene: '底部暖红的光从下往上烧，大量火星快速往上飘、明灭', fit: '适合副歌与激昂段落', keywords: ['火星', '暖红', '上飘', '燃烧'] },
    'motes-snow': { scene: '柔和宽顶光里，大量光点像雪一样缓缓落下', fit: '适合安静段落与冬日感', keywords: ['光雪', '飘落', '冬天', '粒子'] },
    'motes-bokeh': { scene: '一道普通顶光，前景一片片大光斑虚化飘过，焦点在字上', fit: '通用', keywords: ['散景', '虚化', '光斑', '前景'] },
    'motes-mist': { scene: '浓而低伏的雾层，下方画一条地平线，右下的光从雾后透出', fit: '适合开场、间奏与清晨感', keywords: ['晨雾', '地平线', '雾', '清晨'] },
    'motes-swarm': { scene: '顶光柱下，大量粒子成群地绕着字旋转流动、又散开', fit: '适合副歌', keywords: ['粒子群', '旋转', '流动', '顶光'] },
    'motes-dissolve': { scene: '一道普通顶光，字唱完很快碎成光尘飘散，崩解最强', fit: '适合衔接与段落收尾', keywords: ['化尘', '崩解', '消散', '光尘'] },
    'motes-aurora': { scene: '画面上方四道帘子般的绿色光幕带彩边、左右摆动流动，满天星', fit: '适合副歌与辽阔的尾声', keywords: ['极光', '光幕', '绿色', '星空'] },
};

const TYPOGRAPHY_PHRASES: Record<WindowTypography, string> = {
    horizontal: '字横排为主',
    vertical: '字竖排为主',
    crossed: '字纵横交错',
};

/** 文字区在画面里的位置（按中心点粗分）。 */
const regionPhrase = ({ cx, cy }: LumiereProfile['region']) => {
    const vertical = cy <= 0.42 ? '画面上部' : cy >= 0.62 ? '画面下部' : '';
    const horizontal = cx <= 0.44 ? '偏左' : cx >= 0.56 ? '偏右' : '';
    if (!vertical && !horizontal) return '居中';
    if (!vertical) return horizontal;
    return `在${vertical}${horizontal}`;
};

const burstPhrase = (burst: LumiereProfile['burst']) => {
    if (!burst) return '';
    const every = burst.every === 1 ? '' : burst.every === 2 ? '隔行' : `每${'零一二三四五六七八九'[burst.every] ?? burst.every}行`;
    return burst.mode === 'sung' ? `${every}唱到的字冒小十字爆闪` : `${every}一串十字爆闪扫过整行`;
};

const MOOD_KEYWORDS: Record<LumiereProfile['mood'], string | null> = { quiet: '安静', neutral: null, loud: '高能' };

/** 一个光位的描述与关键词；没有手写说明的光位（比如以后新增的）返回 null。 */
export const lumiereStyleNote = (profile: LumiereProfile): Pick<StyleDef, 'label' | 'description' | 'keywords'> | null => {
    const note = NOTES[profile.kind];
    if (!note) return null;
    const text = [TYPOGRAPHY_PHRASES[profile.typography], regionPhrase(profile.region), burstPhrase(profile.burst)].filter(Boolean).join('，');
    const keywords = [
        ...note.keywords,
        LUMIERE_FAMILY_LABELS[profile.family],
        profile.burst ? '十字爆闪' : null,
        MOOD_KEYWORDS[profile.mood],
    ].filter((word): word is string => Boolean(word));
    return {
        label: profile.label,
        description: `${note.scene}。${text}；${note.fit}。`,
        keywords: [...new Set(keywords)],
    };
};

export const LUMIERE_TYPOGRAPHY_SLOT_DESCRIPTION = '当前行与前后一两行怎么排（光位本身不变）。换排版时字沿曲线飞到新位置。';

export const LUMIERE_TYPOGRAPHY_OPTION_DESCRIPTIONS: Record<WindowTypography, string> = {
    horizontal: '当前行横排、字最大，前后行缩小横排在上下；换行时各行滑到新位置',
    vertical: '竖排、从右往左换列，当前行最大，前后行缩小排在两侧',
    crossed: '当前行横排居中，前后行按种子落在四周，横竖都有、还会倾斜；换行时字沿曲线飞并拖细径迹',
};

export const LUMIERE_BURST_SLOT_DESCRIPTION = 'EVA 式十字爆闪：一行里挑中的字被唱到时各冒出一个小十字（白闪、竖光柱急速拉长、横条展开、小冲击环），不到一秒消散。';

export const LUMIERE_BURST_OPTION_DESCRIPTIONS: Record<'on' | 'off', string> = {
    on: '开：唱到的字冒出一串小十字闪光（光位本身没有爆闪的，按每行约三成字、偏橙色的默认值）',
    off: '关：只有点亮时的四芒闪点，没有十字爆闪',
};

/** 给组件槽的选项补上描述。 */
export const describeLumiereSlots = (slots: ComponentSlotDef[]): ComponentSlotDef[] => slots.map(slot => {
    if (slot.id === 'typography') {
        return {
            ...slot,
            description: LUMIERE_TYPOGRAPHY_SLOT_DESCRIPTION,
            options: slot.options.map(option => ({ ...option, description: LUMIERE_TYPOGRAPHY_OPTION_DESCRIPTIONS[option.id as WindowTypography] })),
        };
    }
    if (slot.id === 'burst') {
        return {
            ...slot,
            description: LUMIERE_BURST_SLOT_DESCRIPTION,
            options: slot.options.map(option => ({ ...option, description: LUMIERE_BURST_OPTION_DESCRIPTIONS[option.id as 'on' | 'off'] })),
        };
    }
    return slot;
});
