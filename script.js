// 全局变量
let currentMode = 'normal';
let questions = [];
let allQuestions = []; // 存储所有原始题目
let currentQuestionIndex = 0;
let userAnswers = [];
let examStarted = false;
let currentPage = 1;
const questionsPerPage = 20;

// 答题模式相关变量
let selectedAnswerMode = null; // sequential, random, study, exam
let selectedExamType = null; // A, B, C
let examTimeLimit = 0; // 考试时间限制（分钟）
let examStartTime = null; // 考试开始时间
let examPassScore = 0; // 合格分数

// 自定义解析规则
let customParseRules = {
    questionMarker: '[Q]',
    optionMarker: '[A-F]',
    answerMarker: '[T]',
    questionSeparator: '[J]'
};

// 当前文件信息
let currentFileInfo = {
    name: '',
    extension: ''
};

// 题型分数设置
let questionTypeScores = {
    single: 1,
    multiple: 2,
    trueFalse: 1,
    fillBlank: 2
};

// 错题和收藏功能相关变量
let wrongQuestions = []; // 错题列表
let favoriteQuestions = []; // 收藏题目列表
let currentWrongQuestions = []; // 当前考试的错题
let isQuestionFavorited = false; // 当前题目是否已收藏
let previousSection = 'home'; // 记录进入错题回看或收藏界面前的来源界面

// 批量日志缓冲
let debugBuffer = [];
let debugFlushScheduled = false;

function bufferedDebug(msg) {
    debugBuffer.push(`${new Date().toLocaleTimeString()}: ${msg}`);
    if (!debugFlushScheduled) {
        debugFlushScheduled = true;
        setTimeout(() => {
            const debugDiv = document.querySelector('.debug-info') || (() => {
                const d = document.createElement('div');
                d.className = 'debug-info';
                document.querySelector('.import-section').appendChild(d);
                return d;
            })();
            debugDiv.textContent += debugBuffer.join('\n') + '\n';
            debugDiv.scrollTop = debugDiv.scrollHeight;
            debugBuffer = [];
            debugFlushScheduled = false;
        }, 250); // 250ms 批量刷一次
    }
}

// 进度保存节流
let saveProgressTimeout = null;
function saveExamProgressThrottled() {
    if (saveProgressTimeout) return;
    saveProgressTimeout = setTimeout(() => {
        saveExamProgress();
        saveProgressTimeout = null;
    }, 300); // 300ms 合并多次
}

// 控制并发的 map，保持输入顺序
function parallelMap(arr, fn, { concurrency = 4 } = {}) {
    const results = new Array(arr.length);
    let inFlight = 0;
    let idx = 0;
    return new Promise((resolve, reject) => {
        const next = () => {
            if (idx >= arr.length && inFlight === 0) {
                resolve(results);
                return;
            }
            while (inFlight < concurrency && idx < arr.length) {
                const current = idx++;
                inFlight++;
                fn(arr[current])
                    .then(res => {
                        results[current] = res;
                        inFlight--;
                        next();
                    })
                    .catch(err => reject(err));
            }
        };
        next();
    });
}

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    loadSavedSettings();
    initializeEventListeners();
    initializeExamControls();
});

function initializeEventListeners() {
    // 模式切换
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            switchMode(this.dataset.mode);
        });
    });

    // 文件上传
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    
    // 示例题库按钮
    document.getElementById('sampleBtn').addEventListener('click', loadSampleQuestions);
    document.getElementById('cracBtn').addEventListener('click', loadCracQuestions);

    // 拖拽上传
    initializeDragAndDrop();
    
    // 自定义解析规则设置
    document.getElementById('settingsBtn').addEventListener('click', toggleSettingsPanel);
    document.getElementById('saveSettings').addEventListener('click', saveCustomSettings);
    document.getElementById('resetSettings').addEventListener('click', resetCustomSettings);
    document.getElementById('closeSettings').addEventListener('click', closeSettingsPanel);
    
    // 错题回看和收藏功能
    document.getElementById('favoriteBtn').addEventListener('click', toggleFavorite);
    document.getElementById('wrongQuestionsBtn').addEventListener('click', showWrongQuestions);
    document.getElementById('clearWrongQuestionsBtn').addEventListener('click', clearWrongQuestions);
    document.getElementById('backFromWrongBtn').addEventListener('click', backFromWrongQuestions);
    document.getElementById('clearFavoritesBtn').addEventListener('click', clearFavorites);
    document.getElementById('backFromFavoritesBtn').addEventListener('click', backFromFavorites);
    document.getElementById('viewWrongQuestionsBtn').addEventListener('click', showWrongQuestions);
    document.getElementById('viewFavoritesBtn').addEventListener('click', showFavorites);
    document.getElementById('importNewQuestionsBtn').addEventListener('click', goToHome);
    
    // 数据导出导入功能
    document.getElementById('exportWrongQuestionsBtn').addEventListener('click', exportWrongQuestions);
    document.getElementById('exportFavoritesBtn').addEventListener('click', exportFavorites);
    document.getElementById('exportAllDataBtn').addEventListener('click', exportAllData);
    document.getElementById('importDataBtn').addEventListener('click', () => document.getElementById('dataFileInput').click());
    document.getElementById('dataFileInput').addEventListener('change', handleDataImport);
    
    // 清除本地数据功能
    document.getElementById('clearLocalStorageBtn').addEventListener('click', clearLocalStorage);
    
    // 答题模式选择相关事件
    initializeModeSelection();
    
    // 重置答题按钮
    document.getElementById('resetAnswersBtn').addEventListener('click', resetAnswers);
    
    // 得分显示切换按钮
    document.getElementById('scoreToggleBtn').addEventListener('click', toggleScoreDisplay);
}

function initializeDragAndDrop() {
    const fileUploadArea = document.getElementById('fileUploadArea');
    
    // 防止默认的拖拽行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        fileUploadArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    // 拖拽进入和悬停效果
    ['dragenter', 'dragover'].forEach(eventName => {
        fileUploadArea.addEventListener(eventName, highlight, false);
    });
    
    // 拖拽离开效果
    ['dragleave', 'drop'].forEach(eventName => {
        fileUploadArea.addEventListener(eventName, unhighlight, false);
    });
    
    // 处理文件放置
    fileUploadArea.addEventListener('drop', handleDrop, false);
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight(e) {
    const fileUploadArea = document.getElementById('fileUploadArea');
    fileUploadArea.classList.add('drag-over');
}

function unhighlight(e) {
    const fileUploadArea = document.getElementById('fileUploadArea');
    fileUploadArea.classList.remove('drag-over');
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length > 0) {
        const file = files[0];
        bufferedDebug(`拖拽文件: ${file.name}, 大小: ${file.size} bytes`);
        
        // 模拟文件输入事件
        const fileInput = document.getElementById('fileInput');
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
        
        // 触发文件处理
        handleFileUpload({ target: { files: [file] } });
    }
}

function initializeExamControls() {
    document.getElementById('prevBtn').addEventListener('click', () => navigateQuestion(-1));
    document.getElementById('nextBtn').addEventListener('click', () => navigateQuestion(1));
    document.getElementById('submitBtn').addEventListener('click', submitExam);
    document.getElementById('viewAnswerBtn').addEventListener('click', showCurrentAnswer);
    
    // 暂停和恢复考试按钮
    document.getElementById('pauseBtn').addEventListener('click', pauseExam);
    document.getElementById('resumeBtn').addEventListener('click', resumeExam);
    
    // 答题卡翻页功能
    document.getElementById('prevPageBtn').addEventListener('click', () => changePage(-1));
    document.getElementById('nextPageBtn').addEventListener('click', () => changePage(1));
    document.getElementById('pageInput').addEventListener('change', jumpToPage);

    document.getElementById('restartBtn').addEventListener('click', restartExam);
    document.getElementById('reviewBtn').addEventListener('click', reviewAnswers);
    document.getElementById('newExamBtn').addEventListener('click', selectNewExam);
    document.getElementById('homeBtn').addEventListener('click', goToHome);
    
    // 为结果页面的收藏题目按钮绑定事件
    const favoritesBtn = document.getElementById('favoritesBtn');
    if (favoritesBtn) {
        favoritesBtn.addEventListener('click', showFavorites);
    }
}

function switchMode(mode) {
    currentMode = mode;
    
    // 清除之前的错误信息
    clearMessages();
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
    
    const fileInput = document.getElementById('fileInput');
    if (mode === 'crac') {
        fileInput.accept = '.pdf,.doc,.docx';
        document.querySelector('.file-upload p').textContent = '支持PDF、Word格式的CRAC题库文件';
    } else {
        fileInput.accept = '.csv,.xlsx,.txt';
        document.querySelector('.file-upload p').textContent = '支持CSV、XLSX、TXT格式的题库文件';
    }
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // 清除之前的错误信息
    clearMessages();

    const fileExtension = file.name.split('.').pop().toLowerCase();
    const fileName = file.name.substring(0, file.name.lastIndexOf('.'));
    
    bufferedDebug(`开始处理文件: ${file.name}, 大小: ${file.size} bytes, 类型: ${fileExtension}`);
    
    if (currentMode === 'crac' && ['pdf', 'doc', 'docx'].includes(fileExtension)) {
        if (fileExtension === 'pdf') {
            handlePDFFile(file, fileName, fileExtension);
        } else if (['doc', 'docx'].includes(fileExtension)) {
            handleWordFile(file, fileName, fileExtension);
        }
    } else if (currentMode === 'normal' && ['csv', 'xlsx', 'txt'].includes(fileExtension)) {
        handleNormalFile(file, fileExtension, fileName);
    } else {
        showError('文件格式不匹配当前模式，请检查文件格式和模式选择');
    }
}

async function handlePDFFile(file, fileName, fileExtension) {
    try {
        bufferedDebug('开始解析PDF文件...');
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        
        bufferedDebug(`PDF页数: ${pdf.numPages}`);
        const fullText = await extractPdfTextByLines(pdf);
        
        bufferedDebug(`提取文本长度: ${fullText.length}`);
        parseCracText(fullText, fileName, fileExtension);
        
    } catch (error) {
        showError(`PDF解析失败: ${error.message}`);
        bufferedDebug(`错误详情: ${error.stack}`);
    }
}

async function handleWordFile(file, fileName, fileExtension) {
    try {
        bufferedDebug('开始解析Word文件...');
        
        // 检查mammoth库是否可用
        if (typeof mammoth === 'undefined') {
            showError('Word文档解析库未加载，请刷新页面重试');
            return;
        }
        
        const arrayBuffer = await file.arrayBuffer();
        bufferedDebug(`Word文件大小: ${arrayBuffer.byteLength} bytes`);
        
        // 使用mammoth.js解析Word文档
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        
        if (result.messages && result.messages.length > 0) {
            bufferedDebug(`解析警告: ${result.messages.map(m => m.message).join(', ')}`);
        }
        
        const extractedText = result.value;
        bufferedDebug(`提取文本长度: ${extractedText.length}`);
        
        if (!extractedText || extractedText.trim().length === 0) {
            showError('Word文档内容为空或无法提取文本');
            return;
        }
        
        // 解析CRAC格式文本
        parseCracText(extractedText, fileName, fileExtension);
        
    } catch (error) {
        showError(`Word文档解析失败: ${error.message}`);
        bufferedDebug(`错误详情: ${error.stack}`);
        
        // 如果解析失败，提供示例数据作为备选
        bufferedDebug('正在加载示例CRAC题库作为备选...');
        setTimeout(() => {
            const sampleWordText = `
                [J] 001 [P] 第1章 无线电管理基础 [I] MC1-001
                [Q] 根据《中华人民共和国无线电管理条例》，无线电频谱资源属于什么性质？
                [A] 国家所有的自然资源
                [B] 可以买卖的商品资源
                [C] 企业可以独占的资源
                [D] 个人可以申请的资源
                [T] A

                [J] 002 [P] 第1章 无线电管理基础 [I] MC1-002
                [Q] 业余无线电台的设置使用应当符合什么要求？
                [A] 只需要购买设备即可
                [B] 符合业余业务的宗旨，不得用于商业目的
                [C] 可以用于任何通信目的
                [D] 只能在特定时间使用
                [T] B

                [J] 003 [P] 第2章 频率管理 [I] MC2-001
                [Q] 下列哪个频段是业余无线电的专用频段？
                [A] 88-108MHz
                [B] 144-148MHz
                [C] 450-470MHz
                [D] 800-900MHz
                [T] B
                            `;
            
            bufferedDebug('示例Word文档内容加载完成');
            parseCracText(sampleWordText);
        }, 1000);
    }
}

async function extractPdfTextByLines(pdf) {
    // 生成页码数组 [1, 2, ..., numPages]
    const pages = Array.from({ length: pdf.numPages }, (_, i) => i + 1);

    // 并发提取每一页的行（限制并发避免短时间内太多任务）
    const perPageLines = await parallelMap(pages, async (pageNum) => {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // 按 y 轴分桶
        const linesMap = {};
        textContent.items.forEach(item => {
            const y = item.transform[5];
            const bucket = Math.round(y / 3) * 3;
            if (!linesMap[bucket]) linesMap[bucket] = [];
            linesMap[bucket].push(item);
        });

        // 视觉顺序：从上到下
        const sortedYs = Object.keys(linesMap)
            .map(k => parseInt(k, 10))
            .sort((a, b) => b - a); // PDF y 越大越靠上

        const pageLines = [];
        sortedYs.forEach(yKey => {
            const items = linesMap[yKey];
            items.sort((a, b) => a.transform[4] - b.transform[4]); // x 轴排序
            const lineText = items.map(it => it.str).join(' ');
            pageLines.push(lineText.trim());
        });

        return pageLines; // array of lines for this page
    }, { concurrency: 4 }); // 并发数可调

    // 展平并加换行一次性拼接
    return perPageLines.flat().map(l => l + '\n').join('');
}

// 在 text 中找出多个 pattern 里最早出现的位置，相对于 text 的起点
function findFirstMarkerIndex(text, patterns) {
    let min = -1;
    patterns.forEach(pat => {
        const idx = text.search(pat);
        if (idx !== -1 && (min === -1 || idx < min)) {
            min = idx;
        }
    });
    return min;
}

function formatOptionDisplay(letter, optionText) {
    if (!optionText) return `${letter}.`;
    const trimmed = optionText.trim();
    // 如果已经以 A. 或 A) 或 [A] 开头就不再加前缀
    if (/^[A-Z][\.\)]/.test(trimmed) || /^\[[A-Z]\]/.test(trimmed)) {
        return trimmed;
    }
    return `${letter}. ${trimmed}`;
}

function parseCracText(text, fileName = '', fileExtension = '') {
    questions = [];
    const debugInfo = [];

    // 标准化文本：全角转半角，去除零宽字符（保留普通空格）
    text = text.replace(/（/g, '(').replace(/）/g, ')').replace(/[\u200B-\u200D\uFEFF]/g, '');
    
    // 先按 [J] 分块（每个题目）
    const questionBlocks = [];
    
    // 使用自定义的题目分隔符
    const separatorPattern = new RegExp(customParseRules.questionSeparator.replace(/[\[\]]/g, '\\$&'), 'g');
    const jMatches = [...text.matchAll(separatorPattern)];
    
    if (jMatches.length === 0) {
        showError(`未找到题目分隔符"${customParseRules.questionSeparator}"，请检查文档格式或调整自定义解析规则`);
        return;
    }
    
    // 根据[J]标记的位置分割文本
    for (let i = 0; i < jMatches.length; i++) {
        const startPos = jMatches[i].index;
        const endPos = i < jMatches.length - 1 ? jMatches[i + 1].index : text.length;
        const block = text.substring(startPos, endPos).trim();
        if (block) {
            questionBlocks.push(block);
        }
    }

    questionBlocks.forEach((block, idx) => {
        try {
            // 题目 ID（题目分隔符后紧跟的非空白字符串）
            const separatorEscaped = customParseRules.questionSeparator.replace(/[\[\]]/g, '\\$&');
            const idPattern = new RegExp(separatorEscaped + '\\s*([^\\s\\[\\]]+)');
            const idMatch = block.match(idPattern);
            const id = idMatch ? idMatch[1].trim() : (idx + 1).toString();
            
            bufferedDebug(`题目ID: ${id}`);

            // 章节、编号
            const chapterMatch = block.match(/\[P\]\s*([^\[\]]+)/);
            const chapter = chapterMatch ? chapterMatch[1].trim() : '';
            const numberMatch = block.match(/\[I\]\s*([^\[\]]+)/);
            const number = numberMatch ? numberMatch[1].trim() : '';

            // 构造各类 marker 正则（针对单个标记，比如 [A], [B], [T], [J]）
            let letterClass = customParseRules.optionMarker;
            if (letterClass.startsWith('[') && letterClass.endsWith(']')) {
                letterClass = letterClass.slice(1, -1); // e.g. A-F
            } else {
                letterClass = letterClass.split(/\s*,\s*/).join('');
            }
            const singleOptionRegex = new RegExp(`\\[[${letterClass}]\\]`, 'g'); // matches [A], [B], etc.
            const answerMarkerLetter = customParseRules.answerMarker.replace(/[\[\]]/g, '');
            const separatorMarkerLetter = customParseRules.questionSeparator.replace(/[\[\]]/g, '');
            const answerMarkerRegex = new RegExp(`\\[${answerMarkerLetter}\\]`, 'g');
            const separatorMarkerRegex = new RegExp(`\\[${separatorMarkerLetter}\\]`, 'g');

            // 题干提取（用最早出现的 option/separator 作为终点，不包括答案标记）
            let questionText = '';
            const qIndex = block.indexOf(customParseRules.questionMarker);
            if (qIndex !== -1) {
                const startPos = qIndex + customParseRules.questionMarker.length;
                const relative = block.substring(startPos);
                const nextIdx = findFirstMarkerIndex(relative, [singleOptionRegex, answerMarkerRegex, separatorMarkerRegex]);
                const endPos = nextIdx !== -1 ? startPos + nextIdx : block.length;
                questionText = block.substring(startPos, endPos).trim();
            }

            // 答案：从答案标识符后提取
            let answer = '';
            const tIndex = block.indexOf(customParseRules.answerMarker);
            if (tIndex !== -1) {
                const startPos = tIndex + customParseRules.answerMarker.length;
                // 提取答案标识符后面的内容，直到遇到换行或其他标记
                const answerPart = block.substring(startPos).trim();
                
                // 首先尝试匹配选择题答案（纯A-F大写字母，不包含其他字符）
                const choiceAnswerMatch = answerPart.match(/^\s*([A-F]+)\s*$/);
                if (choiceAnswerMatch) {
                    answer = choiceAnswerMatch[1].toUpperCase();
                } else {
                    // 如果不是选择题答案，则提取整行作为填空题答案
                    const textAnswerMatch = answerPart.match(/^\s*(.+?)(?:\n|$)/);
                    if (textAnswerMatch) {
                        answer = textAnswerMatch[1].trim();
                    }
                }
            }

            // 选项提取
            const options = [];
            const optionMatches = [...block.matchAll(singleOptionRegex)];
            for (let i = 0; i < optionMatches.length; i++) {
                const letter = optionMatches[i][0]; // e.g. "[A]"
                const startPos = optionMatches[i].index + optionMatches[i][0].length;
                const relative = block.substring(startPos);
                const nextIdx = findFirstMarkerIndex(relative, [singleOptionRegex, answerMarkerRegex, separatorMarkerRegex]);
                const endPos = nextIdx !== -1 ? startPos + nextIdx : block.length;
                const text = block.substring(startPos, endPos).trim();
                if (text) {
                    options.push(text);
                }
            }

            bufferedDebug(`题目 ${id} 解析结果: 题干长度=${questionText.length}, 选项数=${options.length}, 答案="${answer}"`);
            
            if (!questionText) {
                debugInfo.push(`题目 ${id} 缺失题干`);
                bufferedDebug(`题目 ${id} 原始块内容: ${block.substring(0, 200)}...`);
            }
            if (options.length === 0) {
                debugInfo.push(`题目 ${id} 没有提取到选项`);
                bufferedDebug(`题目 ${id} 原始块内容: ${block.substring(0, 200)}...`);
            }
            if (!answer) {
                debugInfo.push(`题目 ${id} 没有提取到答案`);
                bufferedDebug(`题目 ${id} 原始块内容: ${block.substring(0, 200)}...`);
            }

            // 智能识别题目类型
            let questionType = "single";
            let finalOptions = options;
            let finalAnswer = answer;
            
            if (questionText && answer) { 
                // 填空题识别：优先识别填空题，但只有在没有选项的情况下
                const hasBlankPlaceholder = questionText.includes('____') || questionText.includes('（）') || questionText.includes('()');
                if ((hasBlankPlaceholder && options.length === 0) ||
                    (answer && !/^[A-F]+$/i.test(answer) && options.length === 0)) {
                    questionType = "fillBlank";
                    finalOptions = [];
                    finalAnswer = answer; // 填空题答案保持原样
                }
                // 判断题识别：检查选项内容是否为"正确"和"错误"
                else {
                    const isTrueFalseOptions = options.length === 2 && 
                        options.some(opt => opt.includes('正确')) && 
                        options.some(opt => opt.includes('错误'));
                    
                    // 或者题干包含判断关键词
                    const judgmentKeywords = ["正确", "错误", "对", "错", "是否", "判断", "√", "×", "T", "F"];
                    const hasJudgmentKeyword = judgmentKeywords.some(keyword => questionText.includes(keyword));
                    const isTrueFalseAnswer = /^[TF√×对错正误]$/i.test(answer.trim());
                    
                    if (isTrueFalseOptions || ((hasJudgmentKeyword || isTrueFalseAnswer) && (options.length === 0 || options.length <= 2))) {
                        questionType = "trueFalse";
                        finalOptions = ["正确", "错误"];
                        // 标准化答案
                        const answerMap = {
                            'T': 'A', 'F': 'B', '√': 'A', '×': 'B',
                            '对': 'A', '错': 'B', '正': 'A', '误': 'B',
                            '正确': 'A', '错误': 'B'
                        };
                        finalAnswer = answerMap[answer.trim()] || (answer.toUpperCase() === 'A' || answer.toUpperCase() === 'B' ? answer.toUpperCase() : 'A');
                    }
                }
                
                // 多选题识别：答案包含多个字母
                if (questionType === "single" && answer.length > 1 && options.length > 0) {
                    questionType = "multiple";
                }
                // 单选题：默认类型（已在初始化时设置）
                
                // 验证题目完整性
                const isComplete = questionText && 
                    ((questionType === "fillBlank" && finalAnswer) ||
                     (questionType === "trueFalse" && finalAnswer) ||
                     (finalOptions.length > 0 && finalAnswer));
                
                if (isComplete) {
                    const question = {
                        id: parseInt(id) || (idx + 1),
                        chapter: chapter || `第${idx + 1}章`,
                        question: questionText,
                        options: finalOptions,
                        correctAnswer: finalAnswer,
                        type: questionType,
                        sourceFile: fileName || 'CRAC文件'
                    };
                    
                    questions.push(question);
                    const typeNames = {
                        "single": "单选题",
                        "multiple": "多选题", 
                        "trueFalse": "判断题",
                        "fillBlank": "填空题"
                    };
                    bufferedDebug(`成功添加题目 ${id}: ${typeNames[questionType]}`);
                } else {
                    debugInfo.push(`跳过不完整题目 id=${id}, type=${questionType}, question="${questionText.substring(0, 50)}...", options=${finalOptions.length}, answer="${finalAnswer}"`);
                }
            } else {
                debugInfo.push(`跳过不完整题目 id=${id}, question="${questionText.substring(0, 50)}...", options=${options.length}, answer="${answer}"`);
            }
        } catch (e) {
            debugInfo.push(`解析块异常: ${e.message}`);
        }
    });

    if (debugInfo.length > 0) {
        bufferedDebug(debugInfo.join('\n'));
    }
    
    if (questions.length > 0) {
        allQuestions = [...questions]; // 保存原始题目
        userAnswers = new Array(questions.length).fill(null);
        bufferedDebug(`成功解析 ${questions.length} 道题目`);
        showSuccess(`🎉 文件解析成功！共导入 ${questions.length} 道题目`);
        if (fileName && fileExtension) {
            showFileInfo(fileName, fileExtension);
        }
        
        // 延迟显示模式选择，让用户先看到成功消息
        setTimeout(() => {
            showModeSelection();
        }, 1000);
    } else {
        showError('未能解析出有效题目，请检查TXT格式是否符合CRAC标准');
    }
}

function handleNormalFile(file, fileExtension, fileName) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            let content = e.target.result;
            bufferedDebug(`文件读取成功，内容长度: ${content.length}`);
            
            if (fileExtension === 'csv') {
                parseCSV(content, fileName, fileExtension);
            } else if (fileExtension === 'txt') {
                parseTXT(content, fileName, fileExtension);
            } else if (fileExtension === 'xlsx') {
                parseXLSX(content, fileName, fileExtension);
            }
        } catch (error) {
            showError(`文件解析失败: ${error.message}`);
        }
    };
    
    reader.onerror = function() {
        showError('文件读取失败，请检查文件是否损坏');
    };
    
    if (fileExtension === 'xlsx') {
        reader.readAsArrayBuffer(file);
    } else {
        // 尝试不同编码
        reader.readAsText(file, 'UTF-8');
    }
}

function parseXLSX(arrayBuffer, fileName = '', fileExtension = '') {
    try {
        // 使用XLSX库解析文件
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // 转换为JSON格式
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length < 2) {
            showError('XLSX文件格式错误：至少需要包含标题行和一行数据');
            return;
        }
        
        // 转换为CSV格式的字符串进行解析
        const csvContent = jsonData.map(row => {
            return row.map(cell => {
                // 处理包含逗号或引号的单元格
                const cellStr = String(cell || '');
                if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                    return '"' + cellStr.replace(/"/g, '""') + '"';
                }
                return cellStr;
            }).join(',');
        }).join('\n');
        
        bufferedDebug(`XLSX解析成功，转换为CSV格式进行处理`);
        
        // 使用现有的CSV解析逻辑
        parseCSV(csvContent, fileName, 'xlsx');
        
    } catch (error) {
        showError(`XLSX文件解析失败: ${error.message}`);
        bufferedDebug(`XLSX解析错误详情: ${error.stack}`);
    }
}

function parseCSV(content, fileName = '', fileExtension = '') {
    questions = [];
    try {
        const lines = content.split('\n').filter(line => line.trim());
        bufferedDebug(`CSV行数: ${lines.length}`);
        
        if (lines.length < 2) {
            throw new Error('CSV文件格式不正确，至少需要标题行和一行数据');
        }
        
        const headers = parseCSVLine(lines[0]);
        bufferedDebug(`CSV标题: ${headers.join(', ')}`);
        
        const parsedQuestions = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length >= 3) {
                const question = {
                    id: i,
                    question: values[0] || `题目 ${i}`,
                    options: [],
                    correctAnswer: values[values.length - 1] || 'A',
                    type: 'single'
                };
                
                // 提取选项（除了第一列问题和最后一列答案）
                for (let j = 1; j < values.length - 1; j++) {
                    if (values[j] && values[j].trim()) {
                        question.options.push(values[j].trim());
                    }
                }
                
                // 智能识别题目类型
                const questionText = question.question;
                const correctAnswer = question.correctAnswer;
                const options = question.options;
                
                // 填空题识别：没有选项或选项都为空，且答案不是单个字母
                if (options.length === 0 || options.every(opt => !opt.trim())) {
                    question.type = 'fillBlank';
                    question.options = []; // 确保填空题选项为空
                }
                // 判断题识别：只有两个选项且包含"正确"、"错误"等关键词
                else if (options.length === 2) {
                    const optionText = options.join('').toLowerCase();
                    if (optionText.includes('正确') && optionText.includes('错误')) {
                        question.type = 'trueFalse';
                    }
                }
                // 多选题识别：答案包含多个字母
                else if (correctAnswer && correctAnswer.length > 1 && /^[A-Z]+$/.test(correctAnswer)) {
                    question.type = 'multiple';
                }
                // 默认为单选题
                else {
                    question.type = 'single';
                }
                
                // 只有当题目有内容时才添加（填空题可以没有选项）
                if (question.question.trim() && (question.options.length > 0 || question.type === 'fillBlank')) {
                    parsedQuestions.push(question);
                }
            }
        }
        
        if (parsedQuestions.length === 0) {
            throw new Error('未能解析出有效题目，请检查CSV格式');
        }
        
        // 为每个题目添加来源文件信息
        const questionsWithSource = parsedQuestions.map(q => ({
            ...q,
            sourceFile: fileName || 'CSV文件'
        }));
        
        questions = questionsWithSource;
        userAnswers = new Array(questions.length).fill(null);
        bufferedDebug(`成功解析 ${questions.length} 道题目`);
        showSuccess(`🎉 CSV文件解析成功！共导入 ${questions.length} 道题目`);
        if (fileName && fileExtension) {
            showFileInfo(fileName, fileExtension);
        }
        
        // 延迟显示模式选择，让用户先看到成功消息
        setTimeout(() => {
            showModeSelection();
        }, 1500);
        
    } catch (error) {
        showError(`CSV解析失败: ${error.message}`);
        bufferedDebug(`CSV内容预览: ${content.substring(0, 200)}...`);
    }
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result;
}

function parseTXT(content, fileName = '', fileExtension = '') {
    try {
        // 首先尝试CRAC格式解析
        if (currentMode === 'crac' || content.includes('[J]') || content.includes('[Q]')) {
            bufferedDebug('检测到CRAC格式，使用CRAC解析器');
            return parseCracText(content, fileName, fileExtension);
        }
        
        // 普通格式解析
        const lines = content.split('\n').filter(line => line.trim());
        bufferedDebug(`TXT行数: ${lines.length}`);
        
        const parsedQuestions = [];
        let currentQuestion = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // 检测题目开始（数字开头）
            if (/^\d+[.、]/.test(line)) {
                if (currentQuestion && currentQuestion.options.length > 0) {
                    parsedQuestions.push(currentQuestion);
                }
                
                currentQuestion = {
                    id: parsedQuestions.length + 1,
                    question: line.replace(/^\d+[.、]\s*/, ''),
                    options: [],
                    correctAnswer: 'A',
                    type: 'single'
                };
            }
            // 检测选项（A、B、C、D开头）
            else if (/^[A-Z][.、)]/.test(line) && currentQuestion) {
                currentQuestion.options.push(line);
            }
            // 检测答案行
            else if (/答案[:：]\s*[A-Z]/.test(line) && currentQuestion) {
                const match = line.match(/答案[:：]\s*([A-Z])/);
                if (match) {
                    currentQuestion.correctAnswer = match[1];
                }
            }
            // 继续题目内容
            else if (currentQuestion && !currentQuestion.options.length) {
                currentQuestion.question += ' ' + line;
            }
        }
        
        // 添加最后一题
        if (currentQuestion && currentQuestion.options.length > 0) {
            parsedQuestions.push(currentQuestion);
        }
        
        if (parsedQuestions.length === 0) {
            throw new Error('未能解析出有效题目，请检查TXT格式');
        }
        
        // 为每个题目添加来源文件信息
        const questionsWithSource = parsedQuestions.map(q => ({
            ...q,
            sourceFile: fileName || 'TXT文件'
        }));
        
        questions = questionsWithSource;
        allQuestions = [...questions]; // 保存原始题目
        userAnswers = new Array(questions.length).fill(null);
        bufferedDebug(`成功解析 ${questions.length} 道题目`);
        showSuccess(`🎉 TXT文件解析成功！共导入 ${questions.length} 道题目`);
        if (fileName && fileExtension) {
            showFileInfo(fileName, fileExtension);
        }
        showModeSelection();
        
    } catch (error) {
        showError(`TXT解析失败: ${error.message}`);
        bufferedDebug(`TXT内容预览: ${content.substring(0, 200)}...`);
    }
}

function loadSampleQuestions() {
    const sampleQuestions = [
        {
            id: 1,
            question: "HTML的全称是什么？",
            options: [
                "A. HyperText Markup Language",
                "B. High Tech Modern Language",
                "C. Home Tool Markup Language",
                "D. Hyperlink and Text Markup Language"
            ],
            correctAnswer: "A",
            type: "single"
        },
        {
            id: 2,
            question: "CSS用于控制什么？",
            options: [
                "A. 网页的结构",
                "B. 网页的样式和布局",
                "C. 网页的交互功能",
                "D. 数据库连接"
            ],
            correctAnswer: "B",
            type: "single"
        },
        {
            id: 3,
            question: "以下哪些是前端开发技术？",
            options: [
                "A. HTML",
                "B. CSS",
                "C. JavaScript",
                "D. Python"
            ],
            correctAnswer: "ABC",
            type: "multiple"
        },
        {
            id: 4,
            question: "JavaScript是一种编译型语言。",
            options: [
                "A. 正确",
                "B. 错误"
            ],
            correctAnswer: "B",
            type: "trueFalse"
        },
        {
            id: 5,
            question: "HTML5是HTML的最新版本。",
            options: [
                "A. 正确",
                "B. 错误"
            ],
            correctAnswer: "A",
            type: "trueFalse"
        },
        {
            id: 6,
            question: "CSS的全称是______。",
            options: [],
            correctAnswer: "Cascading Style Sheets|层叠样式表",
            type: "fillBlank"
        },
        {
            id: 7,
            question: "在JavaScript中，用于输出内容到控制台的方法是______。",
            options: [],
            correctAnswer: "console.log|console.log()",
            type: "fillBlank"
        },
        {
            id: 8,
            question: "HTTP协议默认使用的端口号是______。",
            options: [],
            correctAnswer: "80|八十",
            type: "fillBlank"
        }
    ];
    
    // 为每个示例题目添加来源文件信息
    const questionsWithSource = sampleQuestions.map(q => ({
        ...q,
        sourceFile: '示例题库'
    }));
    
    questions = questionsWithSource;
    allQuestions = [...questions]; // 保存原始题目
    userAnswers = new Array(questions.length).fill(null);
    
    // 设置示例题库的文件信息
    currentFileInfo = {
        name: '示例题库',
        extension: 'sample'
    };
    
    bufferedDebug(`加载示例题库: ${questions.length} 道题目`);
    showSuccess(`🎉 示例题库加载成功！共导入 ${questions.length} 道题目`);
    
    // 显示文件信息
    showFileInfo('示例题库', 'sample');
    
    // 延迟显示模式选择，让用户先看到成功消息
    setTimeout(() => {
        showModeSelection();
    }, 1500);
}

function loadCracQuestions() {
    // 创建文件选择对话框
    const cracFiles = [
        { name: 'A类683.pdf', path: 'crac/A类683.pdf', description: 'A类考试题库 (683题)' },
        { name: 'B类1143.pdf', path: 'crac/B类1143.pdf', description: 'B类考试题库 (1143题)' },
        { name: 'C类1282.pdf', path: 'crac/C类1282.pdf', description: 'C类考试题库 (1282题)' }
    ];
    
    // 创建选择界面
    const modal = document.createElement('div');
    modal.className = 'crac-modal';
    modal.innerHTML = `
        <div class="crac-modal-content">
            <div class="crac-modal-header">
                <h3>选择CRAC题库文件</h3>
                <button class="crac-modal-close">&times;</button>
            </div>
            <div class="crac-modal-body">
                ${cracFiles.map(file => `
                    <div class="crac-file-item" data-path="${file.path}" data-name="${file.name}">
                        <div class="crac-file-icon">📄</div>
                        <div class="crac-file-info">
                            <div class="crac-file-name">${file.name}</div>
                            <div class="crac-file-desc">${file.description}</div>
                        </div>
                    </div>
                `).join('')}
                <div class="crac-manual-upload">
                    <div class="crac-file-item manual-upload-item">
                        <div class="crac-file-icon">📁</div>
                        <div class="crac-file-info">
                            <div class="crac-file-name">手动选择文件</div>
                            <div class="crac-file-desc">如果自动加载失败，请手动选择CRAC题库文件</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 添加事件监听器
    modal.querySelector('.crac-modal-close').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    // 手动文件选择事件
    modal.querySelector('.manual-upload-item').addEventListener('click', () => {
        document.body.removeChild(modal);
        
        // 创建文件输入元素
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.pdf,.doc,.docx';
        fileInput.style.display = 'none';
        
        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                // 切换到CRAC模式
                switchMode('crac');
                
                // 模拟文件上传事件
                handleFileUpload({ target: { files: [file] } });
            }
            document.body.removeChild(fileInput);
        });
        
        document.body.appendChild(fileInput);
        fileInput.click();
    });
    
    // 预设文件选择事件
    modal.querySelectorAll('.crac-file-item:not(.manual-upload-item)').forEach(item => {
        item.addEventListener('click', async () => {
            const filePath = item.dataset.path;
            const fileName = item.dataset.name;
            
            document.body.removeChild(modal);
            
            try {
                showSuccess('正在加载CRAC题库文件...');
                
                // 使用fetch加载文件，增加兼容性处理
                const response = await fetch(filePath);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const arrayBuffer = await response.arrayBuffer();
                if (arrayBuffer.byteLength === 0) {
                    throw new Error('文件内容为空');
                }
                
                const file = new File([arrayBuffer], fileName, { type: 'application/pdf' });
                
                // 切换到CRAC模式
                switchMode('crac');
                
                // 处理PDF文件
                await handlePDFFile(file, fileName, 'pdf');
                
            } catch (error) {
                console.error('CRAC题库自动加载错误:', error);
                
                // 自动加载失败时，提供手动选择选项
                const fallbackMessage = `自动加载失败: ${error.message}\n\n是否要手动选择文件？`;
                
                if (confirm(fallbackMessage)) {
                    // 创建文件输入元素进行手动选择
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = '.pdf,.doc,.docx';
                    fileInput.style.display = 'none';
                    
                    fileInput.addEventListener('change', (event) => {
                        const file = event.target.files[0];
                        if (file) {
                            // 切换到CRAC模式
                            switchMode('crac');
                            
                            // 模拟文件上传事件
                            handleFileUpload({ target: { files: [file] } });
                        }
                        document.body.removeChild(fileInput);
                    });
                    
                    document.body.appendChild(fileInput);
                    fileInput.click();
                } else {
                    showError(`CRAC题库加载失败: ${error.message}`);
                }
            }
        });
    });
}

function startExam() {
    examStarted = true;
    document.querySelector('.import-section').style.display = 'none';
    document.querySelector('.mode-selection-area').style.display = 'none';
    document.querySelector('.exam-area').style.display = 'block';
    document.querySelector('.result-section').style.display = 'none';
    
    // 隐藏主页面导航
    document.querySelector('.main-navigation').style.display = 'none';
    
    currentQuestionIndex = 0;
    currentPage = 1; // 重置到第一页
    
    // 初始化用户答案数组
    userAnswers = new Array(questions.length).fill(null);
    
    // 模拟考试模式下初始化考试时间
    if (selectedAnswerMode === 'exam') {
        examStartTime = new Date();
        examPaused = false;
        pausedTime = 0;
        startExamTimer();
        
        // 显示暂停按钮，隐藏恢复按钮
        document.getElementById('pauseBtn').style.display = 'inline-block';
        document.getElementById('resumeBtn').style.display = 'none';
    } else {
        // 非考试模式隐藏暂停和恢复按钮
        document.getElementById('pauseBtn').style.display = 'none';
        document.getElementById('resumeBtn').style.display = 'none';
    }
    
    // 尝试加载之前的考试进度
    loadExamProgress();
    
    displayQuestion();
    updateAnswerCard();
    updatePaginationControls();
    clearMessages();
}

// 统一处理按钮显示逻辑的函数
function updateActionButtons() {
    const viewAnswerBtn = document.getElementById('viewAnswerBtn');
    const submitBtn = document.getElementById('submitBtn');
    if (!viewAnswerBtn || !submitBtn) return;

    if (selectedAnswerMode === 'study') {
        viewAnswerBtn.style.display = 'inline-block';
        submitBtn.style.display = 'none';
    } else if (selectedAnswerMode === 'exam') {
        viewAnswerBtn.style.display = 'none';
        if (currentQuestionIndex === questions.length - 1) {
            submitBtn.style.display = 'inline-block';
        } else {
            submitBtn.style.display = 'none';
        }
        updateExamTimer();
    } else {
        viewAnswerBtn.style.display = 'inline-block';
        if (currentQuestionIndex === questions.length - 1) {
            submitBtn.style.display = 'inline-block';
        } else {
            submitBtn.style.display = 'none';
        }
    }
}

// 统一更新当前题目UI状态的函数
function updateQuestionUI() {
    updateActionButtons();
    updateNavigationButtons();
    updateFavoriteButton();
}

function displayQuestion() {
    const question = questions[currentQuestionIndex];
    
    // 清除之前显示的答案信息
    const answerDisplay = document.getElementById('answerDisplay');
    if (answerDisplay) {
        answerDisplay.remove();
    }
    
    // 也清除之前 showCurrentAnswer / 填空答案区域留下的显示框
    const existingAnswerArea = document.querySelector('.answer-display-area');
    if (existingAnswerArea) {
        existingAnswerArea.remove();
    }
    
    const typeNames = {
        'single': '单选题',
        'multiple': '多选题',
        'trueFalse': '判断题',
        'fillBlank': '填空题'
    };
    
    document.getElementById('questionNumber').textContent = `第 ${currentQuestionIndex + 1} 题 (${typeNames[question.type] || '单选题'})`;
    document.getElementById('scoreDisplay').textContent = `得分: ${calculateScore()}/${calculateTotalScore()}`;
    
    if (currentMode === 'crac') {
        document.getElementById('questionText').innerHTML = `
            <div style="margin-bottom: 10px; color: #666; font-size: 0.9em;">${question.chapter || ''}</div>
            <div><span style="color: #007bff; font-weight: bold; margin-right: 8px;">[${typeNames[question.type] || '单选题'}]</span>${question.question}</div>
        `;
    } else {
        document.getElementById('questionText').innerHTML = `<span style="color: #007bff; font-weight: bold; margin-right: 8px;">[${typeNames[question.type] || '单选题'}]</span>${question.question}`;
    }
    
    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';
    
    // 填空题特殊处理
    if (question.type === 'fillBlank') {
        const fillBlankElement = document.createElement('div');
        fillBlankElement.className = 'fill-blank-container';
        fillBlankElement.innerHTML = `
            <input type="text" id="fillBlank${currentQuestionIndex}" class="fill-blank-input" placeholder="请输入答案..." style="width: 300px; padding: 8px; border: 2px solid #ddd; border-radius: 4px; font-size: 16px;">
        `;
        
        // 恢复用户之前的填空答案
        const userAnswer = userAnswers[currentQuestionIndex];
        if (userAnswer) {
            fillBlankElement.querySelector('input').value = userAnswer;
        }
        
        // 添加输入事件监听
        fillBlankElement.querySelector('input').addEventListener('input', function(e) {
            userAnswers[currentQuestionIndex] = e.target.value.trim();
            saveExamProgressThrottled();
            // 更新得分显示
            document.getElementById('scoreDisplay').textContent = `得分: ${calculateScore()}/${calculateTotalScore()}`;
        });
        
        // 背题模式下显示正确答案
        if (selectedAnswerMode === 'study') {
            const answerHint = document.createElement('div');
            answerHint.className = 'answer-hint';
            answerHint.style.cssText = 'margin-top: 10px; padding: 8px; background-color: #e8f5e8; border-left: 4px solid #4CAF50; color: #2e7d32;';
            answerHint.textContent = `参考答案: ${question.correctAnswer}`;
            fillBlankElement.appendChild(answerHint);
        }
        
        optionsContainer.appendChild(fillBlankElement);
        
        // 填空题也需要更新UI状态
        updateQuestionUI();
        return;
    }
    
    const inputType = question.type === 'multiple' ? 'checkbox' : 'radio';
    const inputName = question.type === 'multiple' ? `question${currentQuestionIndex}[]` : `question${currentQuestionIndex}`;
    
    question.options.forEach((option, index) => {
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        // 检查选项是否已经包含字母前缀
        const hasPrefix = /^[A-F]\s*\./.test(option.trim());
        const displayOption = hasPrefix ? option : `${String.fromCharCode(65 + index)}. ${option}`;
        
        optionElement.innerHTML = `
            <input type="${inputType}" name="${inputName}" value="${String.fromCharCode(65 + index)}" id="option${currentQuestionIndex}_${index}">
            <label for="option${currentQuestionIndex}_${index}">${displayOption}</label>
        `;
        optionElement.addEventListener('click', () => selectOption(index));
        
        // 恢复用户之前的选择
        const userAnswer = userAnswers[currentQuestionIndex];
        if (question.type === 'multiple') {
            // 多选题：检查当前选项是否在用户答案中
            if (userAnswer && userAnswer.includes(String.fromCharCode(65 + index))) {
                optionElement.classList.add('selected');
                optionElement.querySelector('input').checked = true;
            }
        } else {
            // 单选题：检查是否是用户选择的选项
            if (userAnswer === String.fromCharCode(65 + index)) {
                optionElement.classList.add('selected');
                optionElement.querySelector('input').checked = true;
            }
        }
        
        // 背题模式下自动选中正确答案
        if (selectedAnswerMode === 'study') {
            const correctAnswer = question.correctAnswer;
            if (question.type === 'multiple') {
                if (correctAnswer.includes(String.fromCharCode(65 + index))) {
                    optionElement.classList.add('correct-answer');
                }
            } else {
                if (correctAnswer === String.fromCharCode(65 + index)) {
                    optionElement.classList.add('correct-answer');
                }
            }
        }
        
        optionsContainer.appendChild(optionElement);
    });
    
    // 统一更新UI状态
    updateQuestionUI();
}

function selectOption(optionIndex) {
    const question = questions[currentQuestionIndex];
    
    // 填空题不需要选项选择逻辑
    if (question.type === 'fillBlank') {
        return;
    }
    
    const optionElements = document.querySelectorAll('.option');
    const selectedOption = optionElements[optionIndex];
    const input = selectedOption.querySelector('input');
    
    if (question.type === 'multiple') {
        // 多选题逻辑
        input.checked = !input.checked;
        selectedOption.classList.toggle('selected', input.checked);
        
        // 收集所有选中的选项
        const selectedAnswers = [];
        optionElements.forEach((el, idx) => {
            const checkbox = el.querySelector('input');
            if (checkbox.checked) {
                selectedAnswers.push(String.fromCharCode(65 + idx));
            }
        });
        
        // 按字母顺序排序并记录答案
        userAnswers[currentQuestionIndex] = selectedAnswers.sort().join('');
    } else {
        // 单选题逻辑
        optionElements.forEach(el => {
            el.classList.remove('selected');
            el.querySelector('input').checked = false;
        });
        
        input.checked = true;
        selectedOption.classList.add('selected');
        userAnswers[currentQuestionIndex] = String.fromCharCode(65 + optionIndex);
    }
    
    // 保存到localStorage（节流）
    saveExamProgressThrottled();
    
    updateAnswerCard();
    document.getElementById('scoreDisplay').textContent = `得分: ${calculateScore()}/${calculateTotalScore()}`;
}

function navigateQuestion(direction) {
    const newIndex = currentQuestionIndex + direction;
    if (newIndex >= 0 && newIndex < questions.length) {
        currentQuestionIndex = newIndex;
        
        // 检查是否需要跳转到包含当前题目的页面
        const targetPage = Math.ceil((newIndex + 1) / questionsPerPage);
        if (targetPage !== currentPage) {
            currentPage = targetPage;
        }
        
        displayQuestion();
        updateAnswerCard();
    }
}

function updateNavigationButtons() {
    document.getElementById('prevBtn').disabled = currentQuestionIndex === 0;
    document.getElementById('nextBtn').disabled = currentQuestionIndex === questions.length - 1;
}

// 查看当前题目答案
function showCurrentAnswer() {
    if (currentQuestionIndex >= 0 && currentQuestionIndex < questions.length) {
        const question = questions[currentQuestionIndex];
        const correctAnswer = question.correctAnswer;
        
        // 移除之前的答案显示区域
        const existingAnswerDisplay = document.querySelector('.answer-display-area');
        if (existingAnswerDisplay) {
            existingAnswerDisplay.remove();
        }
        
        if (question.type === 'fillBlank') {
            // 填空题：创建新的答案显示区域
            const answerDisplayArea = document.createElement('div');
            answerDisplayArea.className = 'answer-display-area';
            answerDisplayArea.style.cssText = `
                margin-top: 15px;
                padding: 12px;
                background-color: #e8f5e8;
                border: 2px solid #4CAF50;
                border-radius: 8px;
                color: #2e7d32;
                font-weight: bold;
            `;
            
            // 处理多个正确答案
            const answers = correctAnswer.split('|');
            const answerText = answers.length > 1 ? 
                `参考答案: ${answers.join(' 或 ')}` : 
                `参考答案: ${correctAnswer}`;
            
            answerDisplayArea.innerHTML = `
                <div style="font-size: 16px; margin-bottom: 8px;">✓ 正确答案已显示</div>
                <div style="font-size: 14px;">${answerText}</div>
            `;
            
            // 将答案显示区域添加到选项容器后面
            const optionsContainer = document.getElementById('optionsContainer');
            optionsContainer.parentNode.insertBefore(answerDisplayArea, optionsContainer.nextSibling);
            
        } else {
            // 单选题、多选题、判断题：自动选中正确答案
            const optionsContainer = document.getElementById('optionsContainer');
            const options = optionsContainer.querySelectorAll('.option');
            
            // 清除之前的选择
            options.forEach(option => {
                option.classList.remove('selected');
                const input = option.querySelector('input');
                if (input) input.checked = false;
            });
            
            // 选中正确答案
            if (question.type === 'multiple') {
                // 多选题：选中所有正确选项
                correctAnswer.split('').forEach(letter => {
                    const optionIndex = letter.charCodeAt(0) - 65;
                    if (optionIndex >= 0 && optionIndex < options.length) {
                        const option = options[optionIndex];
                        option.classList.add('selected');
                        const input = option.querySelector('input');
                        if (input) input.checked = true;
                    }
                });
            } else {
                // 单选题、判断题：选中正确选项
                const optionIndex = correctAnswer.charCodeAt(0) - 65;
                if (optionIndex >= 0 && optionIndex < options.length) {
                    const option = options[optionIndex];
                    option.classList.add('selected');
                    const input = option.querySelector('input');
                    if (input) input.checked = true;
                }
            }
            
            // 创建答案显示区域
            const answerDisplayArea = document.createElement('div');
            answerDisplayArea.className = 'answer-display-area';
            answerDisplayArea.style.cssText = `
                margin-top: 15px;
                padding: 12px;
                background-color: #e8f5e8;
                border: 2px solid #4CAF50;
                border-radius: 8px;
                color: #2e7d32;
                font-weight: bold;
            `;
            
            let answerText = '';
            if (question.type === 'multiple') {
                const answers = correctAnswer.split('').map(letter => {
                    const optionIndex = letter.charCodeAt(0) - 65;
                    const raw = question.options[optionIndex] || '';
                    return formatOptionDisplay(letter, raw);
                });
                answerText = answers.join('<br>');
            } else {
                const optionIndex = correctAnswer.charCodeAt(0) - 65;
                const raw = question.options[optionIndex] || '';
                answerText = formatOptionDisplay(correctAnswer, raw);
            }
            
            answerDisplayArea.innerHTML = `
                <div style="font-size: 16px; margin-bottom: 8px;">✓ 正确答案已选中并显示</div>
                <div style="font-size: 14px;">${answerText}</div>
            `;
            
            // 将答案显示区域添加到选项容器后面
            optionsContainer.parentNode.insertBefore(answerDisplayArea, optionsContainer.nextSibling);
        }
    }
}

// 答题卡翻页功能
function changePage(direction) {
    const totalPages = Math.ceil(questions.length / questionsPerPage);
    const newPage = currentPage + direction;
    
    if (newPage >= 1 && newPage <= totalPages) {
        currentPage = newPage;
        updateAnswerCard();
        updatePaginationControls();
    }
}

function jumpToPage() {
    const pageInput = document.getElementById('pageInput');
    const totalPages = Math.ceil(questions.length / questionsPerPage);
    let targetPage = parseInt(pageInput.value);
    
    if (targetPage >= 1 && targetPage <= totalPages) {
        currentPage = targetPage;
        updateAnswerCard();
        updatePaginationControls();
    } else {
        pageInput.value = currentPage;
    }
}

function updatePaginationControls() {
    const totalPages = Math.ceil(questions.length / questionsPerPage);
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInput = document.getElementById('pageInput');
    const totalPagesSpan = document.getElementById('totalPages');
    
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
    pageInput.value = currentPage;
    pageInput.max = totalPages;
    totalPagesSpan.textContent = totalPages;
}

function updateAnswerCard() {
    const answeredCount = userAnswers.filter(answer => answer !== null && answer !== '').length;
    const unansweredCount = questions.length - answeredCount;
    
    document.getElementById('totalQuestions').textContent = questions.length;
    document.getElementById('answeredCount').textContent = answeredCount;
    document.getElementById('unansweredCount').textContent = unansweredCount;
    
    // 统计各题型数量
    const typeCounts = {
        single: 0,
        multiple: 0,
        trueFalse: 0,
        fillBlank: 0
    };
    
    questions.forEach(question => {
        const type = question.type || 'single';
        if (typeCounts.hasOwnProperty(type)) {
            typeCounts[type]++;
        }
    });
    
    // 更新题型统计显示
    document.getElementById('singleChoiceCount').textContent = typeCounts.single;
    document.getElementById('multipleChoiceCount').textContent = typeCounts.multiple;
    document.getElementById('trueFalseCount').textContent = typeCounts.trueFalse;
    document.getElementById('fillBlankCount').textContent = typeCounts.fillBlank;
    
    // 更新收藏题目数量
    const favoritedCountElement = document.getElementById('favoritedCount');
    if (favoritedCountElement) {
        favoritedCountElement.textContent = favoriteQuestions.length;
    }
    
    // 更新进度信息
    const progressElement = document.getElementById('progressInfo');
    if (progressElement) {
        progressElement.textContent = `进度: ${answeredCount}/${questions.length} 题`;
    }
    
    const answerGrid = document.getElementById('answerGrid');
    answerGrid.innerHTML = '';
    
    // 计算分页
    const totalPages = Math.ceil(questions.length / questionsPerPage);
    const startIndex = (currentPage - 1) * questionsPerPage;
    const endIndex = Math.min(startIndex + questionsPerPage, questions.length);
    
    // 只显示当前页的题目
    for (let index = startIndex; index < endIndex; index++) {
        const question = questions[index];
        const answerItem = document.createElement('div');
        answerItem.className = 'answer-item';
        
        // 添加题目类型标识
        const typeNames = {
            'single': '单选',
            'multiple': '多选',
            'trueFalse': '判断',
            'fillBlank': '填空'
        };
        const typeIndicator = typeNames[question.type] || '未知';
        const typeClass = question.type || 'single'; // 默认为单选题类型
        answerItem.innerHTML = `
            <span class="question-number">${index + 1}</span>
            <span class="question-type ${typeClass}">${typeIndicator}</span>
        `;
        
        answerItem.addEventListener('click', () => {
            currentQuestionIndex = index;
            displayQuestion();
            // 检查是否需要跳转到包含当前题目的页面
            const targetPage = Math.ceil((index + 1) / questionsPerPage);
            if (targetPage !== currentPage) {
                currentPage = targetPage;
                updatePaginationControls();
            }
            updateAnswerCard();
        });
        
        // 检查是否已答题
        const hasAnswered = userAnswers[index] !== null && userAnswers[index] !== '';
        
        if (index === currentQuestionIndex) {
            answerItem.classList.add('current');
        } else if (hasAnswered) {
            answerItem.classList.add('answered');
        } else {
            answerItem.classList.add('unanswered');
        }
        
        answerGrid.appendChild(answerItem);
    }
    
    // 更新分页控件
    updatePaginationControls();
}

function submitExam() {
    const unansweredCount = userAnswers.filter(answer => answer === null).length;
    
    // 模拟考试模式下的特殊处理
    if (selectedAnswerMode === 'exam') {
        // 时间到自动提交时不需要确认
        const timeUp = examStartTime && ((new Date() - examStartTime) / 1000 / 60) >= examTimeLimit;
        
        if (unansweredCount > 0 && !timeUp) {
            if (!confirm(`还有 ${unansweredCount} 道题未作答，确定要提交吗？`)) {
                return;
            }
        }
    } else {
        // 其他模式下的正常确认
        if (unansweredCount > 0) {
            if (!confirm(`还有 ${unansweredCount} 道题未作答，确定要提交吗？`)) {
                return;
            }
        }
    }
    
    showResults();
}

function showResults() {
    const score = calculateScore(); // 加权分数
    const correctCount = calculateCorrectCount(); // 实际答对题目数
    const percentage = Math.round((correctCount / questions.length) * 100);
    
    // 停止考试计时器
    if (selectedAnswerMode === 'exam') {
        stopExamTimer();
    }
    
    document.querySelector('.exam-area').style.display = 'none';
    document.querySelector('.result-section').style.display = 'block';
    
    // 隐藏主页面导航
    document.querySelector('.main-navigation').style.display = 'none';
    
    // 基本分数显示
    document.getElementById('finalScore').textContent = `${correctCount}/${questions.length}`;
    document.getElementById('correctCount').textContent = correctCount;
    document.getElementById('wrongCount').textContent = questions.length - correctCount;
    
    // 模拟考试模式下的特殊显示
    if (selectedAnswerMode === 'exam') {
        const isPassed = correctCount >= examPassScore;
        const examTime = examStartTime ? Math.floor((new Date() - examStartTime) / 1000) : 0;
        const timeUsed = formatTime(examTime);
        
        document.getElementById('scorePercentage').innerHTML = `
            <div style="font-size: 1.2em; margin-bottom: 10px;">
                <span style="color: ${isPassed ? 'green' : 'red'}; font-weight: bold;">
                    ${isPassed ? '✓ 合格' : '✗ 不合格'}
                </span>
            </div>
            <div>正确率: ${percentage}%</div>
            <div>用时: ${timeUsed}</div>
            <div>合格标准: ${examPassScore}/${questions.length} (${Math.round((examPassScore / questions.length) * 100)}%)</div>
        `;
    } else {
        document.getElementById('scorePercentage').textContent = `${percentage}%`;
    }
    
    // 添加详细结果列表
    const resultsList = document.getElementById('resultsList');
    if (resultsList) {
        resultsList.innerHTML = '';
        
        // 统计信息
        let answeredCount = 0;
        let singleChoiceCount = 0;
        let multipleChoiceCount = 0;
        let trueFalseCount = 0;
        let fillBlankCount = 0;
        
        const typeNames = {
            single: '单选题',
            multiple: '多选题',
            trueFalse: '判断题',
            fillBlank: '填空题'
        };
        
        questions.forEach((question, index) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            
            const userAnswer = userAnswers[index];
            const hasAnswered = userAnswer !== null && userAnswer !== '';
            const questionType = question.type || 'single';
            const isCorrect = hasAnswered && isAnswerCorrect(userAnswer, question.correctAnswer, questionType);
            
            // 记录错题：包括未回答的题目和回答错误的题目
            if (!hasAnswered || (hasAnswered && !isCorrect)) {
                addToWrongQuestions(question, userAnswer || '未答');
            }
            
            if (hasAnswered) answeredCount++;
            if (question.type === 'single') singleChoiceCount++;
            if (question.type === 'multiple') multipleChoiceCount++;
            if (question.type === 'trueFalse') trueFalseCount++;
            if (question.type === 'fillBlank') fillBlankCount++;
            
            // 格式化用户答案显示
            let userAnswerDisplay = '未答';
            if (hasAnswered) {
                if (question.type === 'multiple') {
                    userAnswerDisplay = userAnswer.split('').join(', ');
                } else if (question.type === 'trueFalse') {
                    userAnswerDisplay = userAnswer === 'A' ? '正确' : '错误';
                } else {
                    userAnswerDisplay = userAnswer;
                }
            }
            
            // 格式化正确答案显示
            let correctAnswerDisplay = question.correctAnswer;
            if (question.type === 'multiple') {
                correctAnswerDisplay = question.correctAnswer.split('').join(', ');
            } else if (question.type === 'trueFalse') {
                correctAnswerDisplay = question.correctAnswer === 'A' ? '正确' : '错误';
            } else if (question.type === 'fillBlank') {
                // 填空题显示所有可能的正确答案
                const answers = question.correctAnswer.split('|');
                correctAnswerDisplay = answers.length > 1 ? answers.join(' 或 ') : question.correctAnswer;
            }
            
            const questionTypeName = typeNames[question.type] || '未知题型';
            
            resultItem.innerHTML = `
                <div class="question-result ${isCorrect ? 'correct' : 'incorrect'}">
                    <h4>题目 ${index + 1} (${questionTypeName}): ${question.question}</h4>
                    <p><strong>你的答案:</strong> ${userAnswerDisplay}</p>
                    <p><strong>正确答案:</strong> ${correctAnswerDisplay}</p>
                    <p><strong>状态:</strong> ${isCorrect ? '✓ 正确' : '✗ 错误'}</p>
                </div>
            `;
            
            resultsList.appendChild(resultItem);
        });
        
        // 添加详细统计信息
        const statsElement = document.createElement('div');
        statsElement.className = 'exam-stats';
        const totalScore = calculateTotalScore();
        const currentScore = calculateScore();
        statsElement.innerHTML = `
            <h3>考试统计</h3>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-label">总得分:</span>
                    <span class="stat-value">${currentScore}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">总分:</span>
                    <span class="stat-value">${totalScore}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">总题数:</span>
                    <span class="stat-value">${questions.length}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">已答题数:</span>
                    <span class="stat-value">${answeredCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">正确题数:</span>
                    <span class="stat-value">${correctCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">单选题:</span>
                    <span class="stat-value">${singleChoiceCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">多选题:</span>
                    <span class="stat-value">${multipleChoiceCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">判断题:</span>
                    <span class="stat-value">${trueFalseCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">填空题:</span>
                    <span class="stat-value">${fillBlankCount}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">已收藏:</span>
                    <span class="stat-value">${favoriteQuestions.length}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">正确率:</span>
                    <span class="stat-value">${percentage}%</span>
                </div>
            </div>
        `;
        
        resultsList.insertBefore(statsElement, resultsList.firstChild);
    }
}

// 宽容的答案比较函数，支持多个正确答案和忽略标点符号
function isAnswerCorrect(userAnswer, correctAnswer, questionType) {
    if (!userAnswer || userAnswer.trim() === '') {
        return false;
    }
    
    // 对于非填空题，使用严格比较
    if (questionType !== 'fillBlank') {
        return userAnswer === correctAnswer;
    }
    
    // 填空题的宽容比较
    const normalizeAnswer = (answer) => {
        return answer.toString()
            .trim()
            .toLowerCase()
            .replace(/[。！？；，、：""''.,!?;:()\[\]{}]/g, '') // 移除中英文标点符号
            .replace(/\s+/g, ' '); // 标准化空格
    };
    
    const normalizedUserAnswer = normalizeAnswer(userAnswer);
    
    // 支持多个正确答案（用|分隔）
    const correctAnswers = correctAnswer.toString().split('|').map(ans => normalizeAnswer(ans));
    
    return correctAnswers.some(correctAns => normalizedUserAnswer === correctAns);
}

function calculateScore() {
    let score = 0;
    questions.forEach((question, index) => {
        if (userAnswers[index] !== null && userAnswers[index] !== '') {
            const userAnswer = userAnswers[index];
            const correctAnswer = question.correctAnswer;
            const questionType = question.type || 'single';
            
            if (isAnswerCorrect(userAnswer, correctAnswer, questionType)) {
                // 根据题型使用不同的分数权重
                const typeScore = questionTypeScores[questionType] || 1;
                score += typeScore;
            }
        }
    });
    return score;
}

// 计算实际答对的题目数量（不考虑权重）
function calculateCorrectCount() {
    let correctCount = 0;
    questions.forEach((question, index) => {
        if (userAnswers[index] !== null && userAnswers[index] !== '') {
            const userAnswer = userAnswers[index];
            const correctAnswer = question.correctAnswer;
            const questionType = question.type || 'single';
            
            if (isAnswerCorrect(userAnswer, correctAnswer, questionType)) {
                correctCount++;
            }
        }
    });
    return correctCount;
}

// 计算总的满分分数（根据题型权重）
function calculateTotalScore() {
    let totalScore = 0;
    questions.forEach((question) => {
        const questionType = question.type || 'single';
        const typeScore = questionTypeScores[questionType] || 1;
        totalScore += typeScore;
    });
    return totalScore;
}

function restartExam() {
    currentQuestionIndex = 0;
    userAnswers = new Array(questions.length).fill(null);
    examStarted = true;
    currentPage = 1;
    
    // 清除之前的考试进度
    clearExamProgress();
    
    // 隐藏结果区域，显示考试区域
    document.querySelector('.result-section').style.display = 'none';
    document.querySelector('.exam-area').style.display = 'block';
    
    displayQuestion();
    updateAnswerCard();
    updatePaginationControls();
}

function selectNewExam() {
    // 重置所有状态
    questions = [];
    userAnswers = [];
    currentQuestionIndex = 0;
    examStarted = false;
    currentPage = 1;
    
    // 清除考试进度
    clearExamProgress();
    
    // 隐藏结果区域和考试区域，显示导入区域
    document.querySelector('.result-section').style.display = 'none';
    document.querySelector('.exam-area').style.display = 'none';
    document.querySelector('.import-section').style.display = 'block';
    
    // 清空文件输入
    document.getElementById('fileInput').value = '';
    
    // 清空调试信息
    clearMessages();
    
    bufferedDebug('已重置系统，请选择新的题库文件');
}

// 自定义试卷配置相关函数
function initializeCustomConfig() {
    const questionCountInput = document.getElementById('customQuestionCount');
    const timeLimitInput = document.getElementById('customTimeLimit');
    const passScoreInput = document.getElementById('customPassScore');
    const passPercentInput = document.getElementById('customPassPercent');
    
    // 设置最大题目数量为当前题库数量
    const maxQuestions = allQuestions.length || questions.length;
    questionCountInput.max = maxQuestions;
    passScoreInput.max = maxQuestions;
    
    // 如果当前设置的题目数量超过题库数量，自动调整
    if (parseInt(questionCountInput.value) > maxQuestions) {
        questionCountInput.value = maxQuestions;
    }
    
    // 添加事件监听器实现合格题数和合格率的同步
    questionCountInput.addEventListener('input', updatePassScoreFromPercent);
    passScoreInput.addEventListener('input', updatePassPercentFromScore);
    passPercentInput.addEventListener('input', updatePassScoreFromPercent);
    timeLimitInput.addEventListener('input', updateCustomExamParams);
    
    // 初始化时同步一次
    updatePassPercentFromScore();
}

function updatePassScoreFromPercent() {
    const questionCount = parseInt(document.getElementById('customQuestionCount').value) || 50;
    const passPercent = parseInt(document.getElementById('customPassPercent').value) || 60;
    const passScore = Math.ceil(questionCount * passPercent / 100);
    
    document.getElementById('customPassScore').value = passScore;
    updateCustomExamParams();
}

function updatePassPercentFromScore() {
    const questionCount = parseInt(document.getElementById('customQuestionCount').value) || 50;
    const passScore = parseInt(document.getElementById('customPassScore').value) || 30;
    const passPercent = Math.round(passScore * 100 / questionCount);
    
    document.getElementById('customPassPercent').value = passPercent;
    updateCustomExamParams();
}

function updateCustomExamParams() {
    if (selectedExamType === 'custom') {
        examTimeLimit = parseInt(document.getElementById('customTimeLimit').value) || 60;
        examPassScore = parseInt(document.getElementById('customPassScore').value) || 30;
    }
}

function getCustomExamConfig() {
    return {
        totalQuestions: parseInt(document.getElementById('customQuestionCount').value) || 50,
        timeLimit: parseInt(document.getElementById('customTimeLimit').value) || 60,
        passScore: parseInt(document.getElementById('customPassScore').value) || 30,
        passPercent: parseInt(document.getElementById('customPassPercent').value) || 60
    };
}

function goToHome() {
    // 重置所有状态
    questions = [];
    userAnswers = [];
    currentQuestionIndex = 0;
    examStarted = false;
    currentPage = 1;
    
    // 隐藏结果区域和考试区域，显示导入区域
    document.querySelector('.result-section').style.display = 'none';
    document.querySelector('.exam-area').style.display = 'none';
    document.querySelector('.import-section').style.display = 'block';
    
    // 隐藏错题回看和收藏题目界面
    document.querySelector('.wrong-questions-section').style.display = 'none';
    document.querySelector('.favorites-section').style.display = 'none';
    
    // 显示主页面导航
    document.querySelector('.main-navigation').style.display = 'block';
    
    // 清空文件输入
    document.getElementById('fileInput').value = '';
    
    // 清空调试信息
    clearMessages();
    
    // 隐藏文件信息
    hideFileInfo();
    
    bufferedDebug('已返回主页，请选择新的题库文件');
}

function reviewAnswers() {
    document.querySelector('.result-section').style.display = 'none';
    document.querySelector('.exam-area').style.display = 'block';
    
    currentQuestionIndex = 0;
    displayReviewQuestion();
    updateReviewAnswerCard();
}

function displayReviewQuestion() {
    const question = questions[currentQuestionIndex];
    
    document.getElementById('questionNumber').textContent = `第 ${currentQuestionIndex + 1} 题 (复盘模式)`;
    document.getElementById('scoreDisplay').textContent = `得分: ${calculateScore()}/${calculateTotalScore()}`;
    
    if (currentMode === 'crac') {
        document.getElementById('questionText').innerHTML = `
            <div style="margin-bottom: 10px; color: #666; font-size: 0.9em;">${question.chapter || ''}</div>
            <div>${question.question}</div>
        `;
    } else {
        document.getElementById('questionText').textContent = question.question;
    }
    
    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';
    
    const userAnswer = userAnswers[currentQuestionIndex] || '';
    const selectedLetters = userAnswer.split(''); // for multiple/single
    
    question.options.forEach((option, index) => {
        const optionElement = document.createElement('div');
        optionElement.className = 'option';
        
        const letter = String.fromCharCode(65 + index);
        optionElement.textContent = formatOptionDisplay(letter, option);
        
        const isCorrect = question.correctAnswer.includes(letter);
        const isSelected = selectedLetters.includes(letter);
        
        if (isCorrect) {
            optionElement.classList.add('correct');
        }
        if (isSelected && !isCorrect) {
            optionElement.classList.add('wrong');
        }
        
        optionsContainer.appendChild(optionElement);
    });
    
    updateNavigationButtons();
}

function updateReviewAnswerCard() {
    const answerGrid = document.getElementById('answerGrid');
    answerGrid.innerHTML = '';
    
    questions.forEach((question, index) => {
        const answerItem = document.createElement('div');
        answerItem.className = 'answer-item';
        answerItem.textContent = index + 1;
        answerItem.addEventListener('click', () => {
            currentQuestionIndex = index;
            displayReviewQuestion();
            updateReviewAnswerCard();
        });
        
        if (index === currentQuestionIndex) {
            answerItem.classList.add('current');
        } else {
            const userAnswer = userAnswers[index] || '';
            
            if (userAnswer) {
                // userAnswer 现在存储的是字母（如 "A" 或 "AB"），不是索引
                const selectedLetters = userAnswer.split('');
                const correctLetters = question.correctAnswer.split('');
                
                // 检查是否完全正确
                const isCorrect = selectedLetters.length === correctLetters.length &&
                                selectedLetters.every(letter => correctLetters.includes(letter));
                
                if (isCorrect) {
                    answerItem.classList.add('correct');
                } else {
                    answerItem.classList.add('wrong');
                }
            } else {
                answerItem.classList.add('unanswered');
            }
        }
        
        answerGrid.appendChild(answerItem);
    });
}

function showError(message) {
    clearMessages();
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    
    // 尝试将错误信息添加到当前可见的区域
    const importSection = document.querySelector('.import-section');
    if (importSection && importSection.style.display !== 'none') {
        importSection.appendChild(errorDiv);
    } else {
        // 如果导入区域不可见，使用alert作为fallback确保用户能看到错误信息
        alert(message);
        return;
    }
    
    // 5秒后自动清除错误信息
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.remove();
        }
    }, 5000);
}

function showDebugInfo(message) {
    let debugDiv = document.querySelector('.debug-info');
    if (!debugDiv) {
        debugDiv = document.createElement('div');
        debugDiv.className = 'debug-info';
        document.querySelector('.import-section').appendChild(debugDiv);
    }
    debugDiv.textContent += new Date().toLocaleTimeString() + ': ' + message + '\n';
    debugDiv.scrollTop = debugDiv.scrollHeight;
}

function clearMessages() {
    const errorMessages = document.querySelectorAll('.error-message');
    const debugMessages = document.querySelectorAll('.debug-info');
    const successMessages = document.querySelectorAll('.success-message');
    
    errorMessages.forEach(msg => msg.remove());
    debugMessages.forEach(msg => msg.remove());
    successMessages.forEach(msg => msg.remove());
}

function showSuccess(message) {
    clearMessages();
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.innerHTML = `
        <div class="success-content">
            <div class="success-icon">✅</div>
            <div class="success-text">${message}</div>
            <button class="success-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    document.querySelector('.import-section').appendChild(successDiv);
    
    // 3秒后自动清除成功信息
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.remove();
        }
    }, 3000);
}

// 显示文件信息
function showFileInfo(fileName, fileExtension) {
    currentFileInfo.name = fileName;
    currentFileInfo.extension = fileExtension;
    
    const fileInfoElement = document.getElementById('fileInfo');
    const fileNameElement = document.getElementById('fileName');
    const fileExtensionElement = document.getElementById('fileExtension');
    
    if (fileInfoElement && fileNameElement && fileExtensionElement) {
        fileNameElement.textContent = fileName;
        fileExtensionElement.textContent = fileExtension;
        fileInfoElement.style.display = 'block';
    }
}

// 隐藏文件信息
function hideFileInfo() {
    const fileInfoElement = document.getElementById('fileInfo');
    if (fileInfoElement) {
        fileInfoElement.style.display = 'none';
    }
    currentFileInfo.name = '';
    currentFileInfo.extension = '';
}

// 自定义解析规则设置功能
function toggleSettingsPanel() {
    const panel = document.getElementById('settingsPanel');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        loadCurrentSettings();
    } else {
        panel.style.display = 'none';
    }
}

function loadCurrentSettings() {
    document.getElementById('questionMarker').value = customParseRules.questionMarker;
    document.getElementById('optionMarker').value = customParseRules.optionMarker;
    document.getElementById('answerMarker').value = customParseRules.answerMarker;
    document.getElementById('questionSeparator').value = customParseRules.questionSeparator;
    
    // 加载题型分数设置
    document.getElementById('singleScore').value = questionTypeScores.single;
    document.getElementById('multipleScore').value = questionTypeScores.multiple;
    document.getElementById('trueFalseScore').value = questionTypeScores.trueFalse;
    document.getElementById('fillBlankScore').value = questionTypeScores.fillBlank;
}

function saveCustomSettings() {
    customParseRules.questionMarker = document.getElementById('questionMarker').value.trim();
    customParseRules.optionMarker = document.getElementById('optionMarker').value.trim();
    customParseRules.answerMarker = document.getElementById('answerMarker').value.trim();
    customParseRules.questionSeparator = document.getElementById('questionSeparator').value.trim();
    
    // 保存题型分数设置
    questionTypeScores.single = parseInt(document.getElementById('singleScore').value) || 1;
    questionTypeScores.multiple = parseInt(document.getElementById('multipleScore').value) || 2;
    questionTypeScores.trueFalse = parseInt(document.getElementById('trueFalseScore').value) || 1;
    questionTypeScores.fillBlank = parseInt(document.getElementById('fillBlankScore').value) || 2;
    
    // 保存到本地存储
    localStorage.setItem('customParseRules', JSON.stringify(customParseRules));
    localStorage.setItem('questionTypeScores', JSON.stringify(questionTypeScores));
    
    bufferedDebug('自定义解析规则和题型分数已保存');
    closeSettingsPanel();
}

function resetCustomSettings() {
    customParseRules = {
        questionMarker: '[Q]',
        optionMarker: '[A-F]',
        answerMarker: '[T]',
        questionSeparator: '[J]'
    };
    
    questionTypeScores = {
        single: 1,
        multiple: 2,
        trueFalse: 1,
        fillBlank: 2
    };
    
    loadCurrentSettings();
    localStorage.removeItem('customParseRules');
    localStorage.removeItem('questionTypeScores');
    bufferedDebug('已恢复默认解析规则和题型分数');
}

function closeSettingsPanel() {
    document.getElementById('settingsPanel').style.display = 'none';
}

// 答题模式选择相关函数
function initializeModeSelection() {
    // 模式卡片选择
    document.querySelectorAll('.mode-card').forEach(card => {
        card.addEventListener('click', function() {
            selectAnswerMode(this.dataset.mode);
        });
    });
    
    // 考试类型选择
    document.querySelectorAll('.exam-type').forEach(type => {
        type.addEventListener('click', function() {
            selectExamType(this.dataset.type);
        });
    });
    
    // 按钮事件
    document.getElementById('backToImportBtn').addEventListener('click', backToImport);
    document.getElementById('startSelectedModeBtn').addEventListener('click', startSelectedMode);
    
    // 初始化自定义配置
    initializeCustomConfig();
}

function selectAnswerMode(mode) {
    selectedAnswerMode = mode;
    
    // 更新UI选中状态
    document.querySelectorAll('.mode-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector(`[data-mode="${mode}"]`).classList.add('selected');
    
    // 显示或隐藏考试配置
    const examConfig = document.getElementById('examConfig');
    if (mode === 'exam') {
        examConfig.style.display = 'block';
        updateStartButton();
    } else {
        examConfig.style.display = 'none';
        selectedExamType = null;
        // 清除所有考试类型的选中状态
        document.querySelectorAll('.exam-type').forEach(examType => {
            examType.classList.remove('selected');
        });
        // 隐藏自定义配置面板
        document.getElementById('customExamConfig').style.display = 'none';
        document.getElementById('startSelectedModeBtn').disabled = false;
    }
}

function selectExamType(type) {
    selectedExamType = type;
    
    // 更新UI选中状态
    document.querySelectorAll('.exam-type').forEach(examType => {
        examType.classList.remove('selected');
    });
    document.querySelector(`[data-type="${type}"]`).classList.add('selected');
    
    // 显示或隐藏自定义配置面板
    const customConfig = document.getElementById('customExamConfig');
    if (type === 'custom') {
        customConfig.style.display = 'block';
        initializeCustomConfig();
    } else {
        customConfig.style.display = 'none';
    }
    
    // 设置考试参数
    const examConfigs = {
        'A': { totalQuestions: 40, singleChoice: 32, multipleChoice: 8, timeLimit: 40, passScore: 30 },
        'B': { totalQuestions: 60, singleChoice: 45, multipleChoice: 15, timeLimit: 60, passScore: 45 },
        'C': { totalQuestions: 90, singleChoice: 70, multipleChoice: 20, timeLimit: 90, passScore: 70 }
    };
    
    if (type !== 'custom') {
        const config = examConfigs[type];
        examTimeLimit = config.timeLimit;
        examPassScore = config.passScore;
    } else {
        // 自定义试卷使用用户设置的参数
        updateCustomExamParams();
    }
    
    updateStartButton();
}

function updateStartButton() {
    const startBtn = document.getElementById('startSelectedModeBtn');
    if (selectedAnswerMode === 'exam') {
        startBtn.disabled = !selectedExamType;
    } else {
        startBtn.disabled = !selectedAnswerMode;
    }
}

function backToImport() {
    document.querySelector('.mode-selection-area').style.display = 'none';
    document.querySelector('.import-section').style.display = 'block';
    
    // 显示主页面导航
    document.querySelector('.main-navigation').style.display = 'block';
    
    // 重置选择状态
    selectedAnswerMode = null;
    selectedExamType = null;
    document.querySelectorAll('.mode-card, .exam-type').forEach(el => {
        el.classList.remove('selected');
    });
    document.getElementById('examConfig').style.display = 'none';
}

function startSelectedMode() {
    if (!selectedAnswerMode) return;
    
    // 根据选择的模式准备题目
    const prepareResult = prepareQuestionsForMode();
    
    // 如果准备失败（用户取消考试），不继续
    if (prepareResult === false) {
        return;
    }
    
    // 更新当前模式显示
    updateCurrentModeDisplay();
    
    // 隐藏模式选择界面，显示考试界面
    document.querySelector('.mode-selection-area').style.display = 'none';
    
    // 开始考试
    startExam();
}

// 检测单选题答案分布，如果90%以上都是同一个选项则返回true
function checkSingleChoiceAnswerDistribution(questionsList) {
    const singleChoiceQuestions = questionsList.filter(q => 
        q.type === 'single' && q.options && q.options.length > 0
    );
    
    if (singleChoiceQuestions.length < 10) {
        // 单选题数量太少，不进行检测
        return false;
    }
    
    // 统计各选项的分布
    const answerDistribution = {};
    singleChoiceQuestions.forEach(question => {
        const answer = question.correctAnswer;
        if (answer && /^[A-F]$/.test(answer)) {
            answerDistribution[answer] = (answerDistribution[answer] || 0) + 1;
        }
    });
    
    // 检查是否有选项占比超过90%
    const totalSingleChoice = singleChoiceQuestions.length;
    for (const [option, count] of Object.entries(answerDistribution)) {
        const percentage = (count / totalSingleChoice) * 100;
        if (percentage >= 90) {
            console.log(`检测到单选题答案分布异常：选项${option}占比${percentage.toFixed(1)}%，将打乱选项顺序`);
            return true;
        }
    }
    
    return false;
}

// 为所有题目打乱选项顺序
function shuffleOptionsForAllQuestions(questionsList) {
    return questionsList.map(question => {
        // 只对有选项的题目进行打乱（单选题、多选题、判断题）
        if (!question.options || question.options.length === 0 || question.type === 'fillBlank') {
            return { ...question };
        }
        
        // 创建选项索引映射
        const originalOptions = [...question.options];
        const optionIndices = originalOptions.map((_, index) => index);
        const shuffledIndices = shuffleArray([...optionIndices]);
        
        // 重新排列选项
        const shuffledOptions = shuffledIndices.map(index => originalOptions[index]);
        
        // 更新正确答案
        let newCorrectAnswer = question.correctAnswer;
        if (question.type === 'single' || question.type === 'trueFalse') {
            // 单选题和判断题：找到原答案对应的新位置
            const originalAnswerIndex = question.correctAnswer.charCodeAt(0) - 65;
            const newAnswerIndex = shuffledIndices.indexOf(originalAnswerIndex);
            newCorrectAnswer = String.fromCharCode(65 + newAnswerIndex);
        } else if (question.type === 'multiple') {
            // 多选题：更新所有正确答案的位置
            const originalAnswers = question.correctAnswer.split('');
            const newAnswers = originalAnswers.map(answer => {
                const originalIndex = answer.charCodeAt(0) - 65;
                const newIndex = shuffledIndices.indexOf(originalIndex);
                return String.fromCharCode(65 + newIndex);
            }).sort(); // 保持字母顺序
            newCorrectAnswer = newAnswers.join('');
        }
        
        return {
            ...question,
            options: shuffledOptions,
            correctAnswer: newCorrectAnswer,
            optionsShuffled: true // 标记选项已被打乱
        };
    });
}

function prepareQuestionsForMode() {
    // 备份原始题目
    allQuestions = [...questions];
    
    // 检测单选题答案分布并决定是否打乱选项
    const shouldShuffleOptions = checkSingleChoiceAnswerDistribution(allQuestions);
    
    switch (selectedAnswerMode) {
        case 'sequential':
            // 顺序答题，保持原有顺序
            if (shouldShuffleOptions) {
                questions = shuffleOptionsForAllQuestions([...allQuestions]);
            }
            break;
            
        case 'random':
            // 乱序答题，打乱题目顺序
            questions = shuffleArray([...allQuestions]);
            if (shouldShuffleOptions) {
                questions = shuffleOptionsForAllQuestions(questions);
            }
            break;
            
        case 'study':
            // 背题模式，保持原有顺序，但允许查看答案
            if (shouldShuffleOptions) {
                questions = shuffleOptionsForAllQuestions([...allQuestions]);
            }
            break;
            
        case 'exam':
            // 模拟考试，根据选择的类型抽取题目
            questions = generateExamQuestions();
            if (questions.length === 0) {
                // 用户选择不继续考试，返回到模式选择界面
                alert('考试已取消，请检查题库或选择其他考试类型。');
                return false; // 返回false表示准备失败
            }
            if (shouldShuffleOptions) {
                questions = shuffleOptionsForAllQuestions(questions);
            }
            break;
    }
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function generateExamQuestions() {
    if (!selectedExamType || !allQuestions.length) return [];
    
    // 自定义试卷处理
    if (selectedExamType === 'custom') {
        const customConfig = getCustomExamConfig();
        const totalQuestions = Math.min(customConfig.totalQuestions, allQuestions.length);
        
        // 随机抽取指定数量的题目
        const selectedQuestions = getRandomQuestions(allQuestions, totalQuestions);
        return shuffleArray(selectedQuestions);
    }
    
    // 预设试卷配置
    const examConfigs = {
        'A': { totalQuestions: 40, singleChoice: 32, multipleChoice: 8 },
        'B': { totalQuestions: 60, singleChoice: 45, multipleChoice: 15 },
        'C': { totalQuestions: 90, singleChoice: 70, multipleChoice: 20 }
    };
    
    const config = examConfigs[selectedExamType];
    
    // 分离单选题和多选题
    const singleChoiceQuestions = allQuestions.filter(q => q.type === 'single');
    const multipleChoiceQuestions = allQuestions.filter(q => q.type === 'multiple');
    
    // 调试信息：显示题库统计
    console.log(`${selectedExamType}类考试题库统计:`);
    console.log(`- 总题目数: ${allQuestions.length}`);
    console.log(`- 单选题数: ${singleChoiceQuestions.length} (需要: ${config.singleChoice})`);
    console.log(`- 多选题数: ${multipleChoiceQuestions.length} (需要: ${config.multipleChoice})`);
    
    // 检查题目数量是否充足
    if (singleChoiceQuestions.length < config.singleChoice) {
        const continueExam = confirm(`警告：题库中单选题数量不足！\n需要: ${config.singleChoice}道\n实际: ${singleChoiceQuestions.length}道\n\n将使用所有可用的单选题，考试题目总数可能少于预期。\n\n是否继续考试？`);
        if (!continueExam) {
            return []; // 用户选择不继续，返回空数组
        }
    }
    
    if (multipleChoiceQuestions.length < config.multipleChoice) {
        const continueExam = confirm(`警告：题库中多选题数量不足！\n需要: ${config.multipleChoice}道\n实际: ${multipleChoiceQuestions.length}道\n\n将使用所有可用的多选题，考试题目总数可能少于预期。\n\n是否继续考试？`);
        if (!continueExam) {
            return []; // 用户选择不继续，返回空数组
        }
    }
    
    // 随机抽取指定数量的题目
    const selectedSingle = getRandomQuestions(singleChoiceQuestions, config.singleChoice);
    const selectedMultiple = getRandomQuestions(multipleChoiceQuestions, config.multipleChoice);
    
    // 合并并打乱顺序
    const examQuestions = [...selectedSingle, ...selectedMultiple];
    
    // 调试信息：显示实际抽取结果
    console.log(`实际抽取结果:`);
    console.log(`- 单选题: ${selectedSingle.length}道`);
    console.log(`- 多选题: ${selectedMultiple.length}道`);
    console.log(`- 总计: ${examQuestions.length}道`);
    
    return shuffleArray(examQuestions);
}

function getRandomQuestions(questions, count) {
    if (questions.length <= count) return [...questions];
    
    const shuffled = shuffleArray(questions);
    return shuffled.slice(0, count);
}

function showModeSelection() {
    document.querySelector('.import-section').style.display = 'none';
    document.querySelector('.mode-selection-area').style.display = 'block';
    
    // 隐藏主页面导航
    document.querySelector('.main-navigation').style.display = 'none';
}

// 考试计时器相关函数
let examTimer = null;
let examPaused = false;
let pausedTime = 0; // 暂停累计的秒数
let pauseStartTimestamp = null; // 本次暂停开始的时间戳（毫秒）

function startExamTimer() {
    if (examTimer) {
        clearInterval(examTimer);
    }
    
    examTimer = setInterval(updateExamTimer, 1000);
}

function updateExamTimer() {
    if (!examStartTime || selectedAnswerMode !== 'exam' || examPaused) return;
    
    const now = new Date();
    const elapsed = Math.floor((now - examStartTime) / 1000) - pausedTime; // 已用时间（秒）- 暂停时间
    const totalTime = examTimeLimit * 60; // 总时间（秒）
    const remaining = totalTime - elapsed; // 剩余时间（秒）
    
    // 更新题目编号区域显示时间
    const questionNumber = document.getElementById('questionNumber');
    const timeDisplay = formatTime(remaining);
    
    if (remaining <= 0) {
        // 时间到，自动提交
        clearInterval(examTimer);
        // 获取基础文本（不包含时间显示）
        const baseText = questionNumber.innerHTML.split('<br>')[0];
        questionNumber.innerHTML = baseText + '<br><span style="color: red;">时间到！</span>';
        setTimeout(() => {
            submitExam();
        }, 1000);
    } else {
        // 更新时间显示
        // 获取基础文本（不包含时间显示）
        const baseText = questionNumber.innerHTML.split('<br>')[0];
        const timeColor = remaining <= 300 ? 'red' : (remaining <= 600 ? 'orange' : 'green'); // 5分钟红色，10分钟橙色
        const statusText = examPaused ? '已暂停' : `剩余时间: ${timeDisplay}`;
        const statusColor = examPaused ? 'blue' : timeColor;
        questionNumber.innerHTML = baseText + `<br><span style="color: ${statusColor};">${statusText}</span>`;
    }
}

function formatTime(seconds) {
    if (seconds < 0) return '00:00';
    
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function stopExamTimer() {
    if (examTimer) {
        clearInterval(examTimer);
        examTimer = null;
    }
}

function pauseExam() {
    if (selectedAnswerMode !== 'exam' || examPaused) return;

    examPaused = true;
    pauseStartTimestamp = Date.now(); // 记录暂停开始

    // 停止计时器
    if (examTimer) {
        clearInterval(examTimer);
        examTimer = null;
    }

    // 更新按钮显示
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('resumeBtn').style.display = 'inline-block';

    // 更新时间显示
    const questionNumber = document.getElementById('questionNumber');
    const baseText = questionNumber.innerHTML.split('<br>')[0];
    questionNumber.innerHTML = baseText + '<br><span style="color: blue;">考试已暂停</span>';

    // 禁用答题功能
    const optionElements = document.querySelectorAll('.option');
    optionElements.forEach(option => {
        option.style.pointerEvents = 'none';
        option.style.opacity = '0.6';
    });

    // 禁用导航按钮
    document.getElementById('prevBtn').disabled = true;
    document.getElementById('nextBtn').disabled = true;
    document.getElementById('submitBtn').disabled = true;

    console.log('考试已暂停');
}

// 恢复考试
function resumeExam() {
    if (selectedAnswerMode !== 'exam' || !examPaused) return;

    // 计算本次暂停持续的时间（秒），累加到 pausedTime
    const now = Date.now();
    if (pauseStartTimestamp) {
        const pauseDuration = Math.floor((now - pauseStartTimestamp) / 1000);
        pausedTime += pauseDuration;
        pauseStartTimestamp = null;
    }
    examPaused = false;

    // 立即更新一次时间显示，避免延迟
    updateExamTimer();
    
    // 重新启动计时器
    startExamTimer();

    // 更新按钮显示
    document.getElementById('pauseBtn').style.display = 'inline-block';
    document.getElementById('resumeBtn').style.display = 'none';

    // 恢复答题功能
    const optionElements = document.querySelectorAll('.option');
    optionElements.forEach(option => {
        option.style.pointerEvents = 'auto';
        option.style.opacity = '1';
    });

    // 恢复导航按钮
    document.getElementById('prevBtn').disabled = false;
    document.getElementById('nextBtn').disabled = false;
    document.getElementById('submitBtn').disabled = false;

    console.log('考试已恢复');
}

// 加载保存的自定义解析规则
function loadSavedSettings() {
    const saved = localStorage.getItem('customParseRules');
    if (saved) {
        try {
            customParseRules = JSON.parse(saved);
        } catch (e) {
            console.warn('加载自定义解析规则失败，使用默认设置');
        }
    }
    
    const savedScores = localStorage.getItem('questionTypeScores');
    if (savedScores) {
        try {
            questionTypeScores = JSON.parse(savedScores);
        } catch (e) {
            console.warn('加载题型分数设置失败，使用默认设置');
        }
    }
    
    // 加载错题和收藏数据
    loadFromLocalStorage();
}

// 保存考试进度到localStorage
function saveExamProgress() {
    const examData = {
        currentQuestionIndex: currentQuestionIndex,
        userAnswers: userAnswers,
        currentPage: currentPage,
        timestamp: Date.now()
    };
    localStorage.setItem('examProgress', JSON.stringify(examData));
}

// 从localStorage加载考试进度
function loadExamProgress() {
    const saved = localStorage.getItem('examProgress');
    if (saved) {
        try {
            const examData = JSON.parse(saved);
            // 检查是否是最近的考试进度（24小时内）
            const timeDiff = Date.now() - examData.timestamp;
            if (timeDiff < 24 * 60 * 60 * 1000) { // 24小时
                if (examData.userAnswers && examData.userAnswers.length === questions.length) {
                    userAnswers = examData.userAnswers;
                    currentQuestionIndex = examData.currentQuestionIndex || 0;
                    currentPage = examData.currentPage || 1;
                    bufferedDebug('已恢复之前的考试进度');
                }
            } else {
                // 清除过期的进度数据
                localStorage.removeItem('examProgress');
            }
        } catch (e) {
            console.warn('加载考试进度失败:', e);
            localStorage.removeItem('examProgress');
        }
    }
}

// 清除考试进度
function clearExamProgress() {
    localStorage.removeItem('examProgress');
}

// 更新当前模式显示
function updateCurrentModeDisplay() {
    const currentModeElement = document.getElementById('currentMode');
    if (!currentModeElement) return;
    
    let modeText = '当前模式: ';
    switch (selectedAnswerMode) {
        case 'sequential':
            modeText += '顺序答题';
            break;
        case 'random':
            modeText += '乱序答题';
            break;
        case 'study':
            modeText += '背题模式';
            break;
        case 'exam':
            if (selectedExamType === 'custom') {
                const customConfig = getCustomExamConfig();
                modeText += `模拟考试 (自定义试卷 - ${customConfig.totalQuestions}题)`;
            } else {
                modeText += `模拟考试 (${selectedExamType}类)`;
            }
            break;
        default:
            modeText += '未选择';
    }
    
    currentModeElement.textContent = modeText;
}

// 重置答题功能
function resetAnswers() {
    if (!examStarted) return;
    
    const confirmReset = confirm('确定要重置所有答题记录吗？此操作不可撤销。');
    if (!confirmReset) return;
    
    // 重置用户答案
    userAnswers = new Array(questions.length).fill(null);
    
    // 重置当前题目索引
    currentQuestionIndex = 0;
    
    // 更新答题卡
    updateAnswerCard();
    
    // 重新显示当前题目
    displayQuestion();
    
    // 清除进度保存
    clearExamProgress();
    
    bufferedDebug('答题记录已重置');
}

// ==================== 错题回看和收藏功能 ====================

// 本地存储管理
function saveToLocalStorage() {
    try {
        const data = {
            wrongQuestions: wrongQuestions,
            favoriteQuestions: favoriteQuestions,
            customParseRules: customParseRules,
            questionTypeScores: questionTypeScores
        };
        localStorage.setItem('examCracData', JSON.stringify(data));
    } catch (error) {
        console.error('保存到本地存储失败:', error);
    }
}

function loadFromLocalStorage() {
    try {
        const data = localStorage.getItem('examCracData');
        if (data) {
            const parsed = JSON.parse(data);
            wrongQuestions = parsed.wrongQuestions || [];
            favoriteQuestions = parsed.favoriteQuestions || [];
            if (parsed.customParseRules) {
                customParseRules = { ...customParseRules, ...parsed.customParseRules };
            }
            if (parsed.questionTypeScores) {
                questionTypeScores = { ...questionTypeScores, ...parsed.questionTypeScores };
            }
        }
    } catch (error) {
        console.error('从本地存储加载失败:', error);
        wrongQuestions = [];
        favoriteQuestions = [];
    }
}

// 收藏功能
function toggleFavorite() {
    if (questions.length === 0 || currentQuestionIndex >= questions.length) {
        showError('没有可收藏的题目');
        return;
    }
    
    const currentQuestion = questions[currentQuestionIndex];
    const questionId = generateQuestionId(currentQuestion);
    
    const existingIndex = favoriteQuestions.findIndex(q => generateQuestionId(q) === questionId);
    
    if (existingIndex >= 0) {
        // 取消收藏
        favoriteQuestions.splice(existingIndex, 1);
        isQuestionFavorited = false;
        showSuccess('已取消收藏');
    } else {
        // 添加收藏
        favoriteQuestions.push({
            ...currentQuestion,
            sourceFile: currentFileInfo.name,
            addedTime: new Date().toISOString()
        });
        isQuestionFavorited = true;
        showSuccess('已添加到收藏');
    }
    
    updateFavoriteButton();
    saveToLocalStorage();
    
    // 更新答题卡中的收藏数量显示
    const favoritedCountElement = document.getElementById('favoritedCount');
    if (favoritedCountElement) {
        favoritedCountElement.textContent = favoriteQuestions.length;
    }
}

function updateFavoriteButton() {
    const favoriteBtn = document.getElementById('favoriteBtn');
    if (!favoriteBtn) return;
    
    if (questions.length === 0 || currentQuestionIndex >= questions.length) {
        favoriteBtn.style.display = 'none';
        return;
    }
    
    favoriteBtn.style.display = 'block';
    
    const currentQuestion = questions[currentQuestionIndex];
    const questionId = generateQuestionId(currentQuestion);
    isQuestionFavorited = favoriteQuestions.some(q => generateQuestionId(q) === questionId);
    
    if (isQuestionFavorited) {
        favoriteBtn.textContent = '⭐ 已收藏';
        favoriteBtn.classList.add('favorited');
    } else {
        favoriteBtn.textContent = '⭐ 收藏';
        favoriteBtn.classList.remove('favorited');
    }
}

// 生成题目唯一ID
function generateQuestionId(question) {
    const answerPart = question.correctAnswer || question.answer || '';
    return btoa(encodeURIComponent(question.question + (question.options ? question.options.join('') : '') + answerPart)).substring(0, 20);
}

// 错题管理
function addToWrongQuestions(question, userAnswer) {
    const questionId = generateQuestionId(question);
    const existingIndex = wrongQuestions.findIndex(q => generateQuestionId(q) === questionId);
    
    const wrongQuestion = {
        ...question,
        userAnswer: userAnswer,
        sourceFile: currentFileInfo.name,
        wrongTime: new Date().toISOString(),
        wrongCount: 1
    };
    
    if (existingIndex >= 0) {
        // 更新错题信息
        wrongQuestions[existingIndex] = {
            ...wrongQuestions[existingIndex],
            userAnswer: userAnswer,
            wrongTime: new Date().toISOString(),
            wrongCount: (wrongQuestions[existingIndex].wrongCount || 1) + 1
        };
    } else {
        // 添加新错题
        wrongQuestions.push(wrongQuestion);
    }
    
    saveToLocalStorage();
}

// 显示错题回看界面
function showWrongQuestions() {
    if (wrongQuestions.length === 0) {
        showError('暂无错题记录');
        alert('暂无错题记录'); // 临时保障用户能感知
        return;
    }
    
    // 记录来源界面
    if (document.getElementById('resultsSection').style.display !== 'none') {
        previousSection = 'results';
    } else {
        previousSection = 'home';
    }
    
    // 统一隐藏其它视图（用 class + id 都安全地尝试）
    document.querySelector('.import-section')?.style.setProperty('display', 'none');
    document.querySelector('.mode-selection-area')?.style.setProperty('display', 'none');
    document.querySelector('.exam-area')?.style.setProperty('display', 'none');
    document.querySelector('.result-section')?.style.setProperty('display', 'none');
    document.getElementById('homeSection')?.style.setProperty('display', 'none');
    document.getElementById('examSection')?.style.setProperty('display', 'none');
    document.getElementById('resultsSection')?.style.setProperty('display', 'none');
    document.getElementById('favoritesSection')?.style.setProperty('display', 'none');
    
    // 隐藏主页面导航
    document.querySelector('.main-navigation')?.style.setProperty('display', 'none');
    
    // 显示错题区
    const wrongSection = document.getElementById('wrongQuestionsSection');
    if (!wrongSection) {
        console.warn('找不到 #wrongQuestionsSection');
        alert('错题界面元素未找到，请检查页面结构');
        return;
    }
    wrongSection.style.display = 'block';
    
    // 更新统计信息
    const wrongCountElement = document.getElementById('wrongQuestionsCount');
    if (wrongCountElement) {
        wrongCountElement.textContent = wrongQuestions.length;
    }
    
    const sourceFiles = [...new Set(wrongQuestions.map(q => q.sourceFile).filter(f => f))];
    const wrongSourceElement = document.getElementById('wrongQuestionsSource');
    if (wrongSourceElement) {
        wrongSourceElement.textContent = sourceFiles.join(', ') || '未知';
    }
    
    // 渲染错题列表
    renderQuestionList(wrongQuestions, 'wrongQuestionsList', 'wrong');
}

// 显示收藏题目界面
function showFavorites() {
    if (favoriteQuestions.length === 0) {
        showError('暂无收藏题目');
        return;
    }
    
    // 记录来源界面
    if (document.getElementById('resultsSection').style.display !== 'none') {
        previousSection = 'results';
    } else {
        previousSection = 'home';
    }
    
    // 隐藏其他界面
    document.getElementById('homeSection').style.display = 'none';
    document.getElementById('examSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('wrongQuestionsSection').style.display = 'none';
    
    // 隐藏主页面导航
    document.querySelector('.main-navigation').style.display = 'none';
    
    // 显示收藏界面
    document.getElementById('favoritesSection').style.display = 'block';
    
    // 更新统计信息
    document.getElementById('favoritesCount').textContent = favoriteQuestions.length;
    const sourceFiles = [...new Set(favoriteQuestions.map(q => q.sourceFile).filter(f => f))];
    document.getElementById('favoritesSource').textContent = sourceFiles.join(', ') || '未知';
    
    // 渲染收藏列表
    renderQuestionList(favoriteQuestions, 'favoritesList', 'favorite');
}

// 渲染题目列表
function renderQuestionList(questionsList, containerId, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    questionsList.forEach((question, index) => {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'question-item';
        
        let optionsHtml = '';
        if (question.options && question.options.length > 0) {
            optionsHtml = question.options.map((option, i) => {
                const letter = String.fromCharCode(65 + i);
                let optionClass = 'question-option';
                
                // 标记正确答案
                if (question.correctAnswer && question.correctAnswer.includes(letter)) {
                    optionClass += ' correct-answer';
                }
                
                // 标记用户错误答案（仅错题）
                if (type === 'wrong' && question.userAnswer && question.userAnswer.includes(letter) && !question.correctAnswer.includes(letter)) {
                    optionClass += ' wrong-answer';
                }
                
                return `<div class="${optionClass}">${letter}. ${option}</div>`;
            }).join('');
        }
        
        let metaInfo = '';
        if (type === 'wrong') {
            metaInfo = `
                <div class="question-meta">
                    <span>错误次数: ${question.wrongCount || 1}</span>&emsp;&emsp;
                    <span>最近错误: ${new Date(question.wrongTime).toLocaleString()}</span>&emsp;&emsp;
                    <span>来源: ${question.sourceFile || '未知'}</span>
                </div>
            `;
        } else {
            metaInfo = `
                <div class="question-meta">
                    <span>收藏时间: ${new Date(question.addedTime).toLocaleString()}</span>
                    <span>来源: ${question.sourceFile || '未知'}</span>
                </div>
            `;
        }
        
        questionDiv.innerHTML = `
            <div class="question-header">
                <span class="question-number">第 ${index + 1} 题</span>
                <div class="question-actions">
                    <button class="remove-btn" onclick="removeFromList('${type}', ${index})">
                        ${type === 'wrong' ? '移除错题' : '取消收藏'}
                    </button>
                </div>
            </div>
            <div class="question-content">
                <div class="question-text">${question.question}</div>
                ${optionsHtml}
                <div class="question-answer">
                    <strong class="correct-answer-text">正确答案: ${question.correctAnswer}</strong>
                    ${type === 'wrong' && question.userAnswer ? `<br><span class="user-answer">你的答案: ${question.userAnswer}</span>` : ''}
                </div>
                ${question.explanation ? `<div class="question-explanation"><strong>解析:</strong> ${question.explanation}</div>` : ''}
                ${metaInfo}
            </div>
        `;
        
        container.appendChild(questionDiv);
    });
}

// 从列表中移除题目
function removeFromList(type, index) {
    if (type === 'wrong') {
        if (confirm('确定要移除这道错题吗？')) {
            wrongQuestions.splice(index, 1);
            saveToLocalStorage();
            if (wrongQuestions.length === 0) {
                backFromWrongQuestions();
            } else {
                showWrongQuestions();
            }
        }
    } else if (type === 'favorite') {
        if (confirm('确定要取消收藏这道题目吗？')) {
            favoriteQuestions.splice(index, 1);
            saveToLocalStorage();
            updateFavoriteButton(); // 更新当前题目的收藏状态
            if (favoriteQuestions.length === 0) {
                backFromFavorites();
            } else {
                showFavorites();
            }
        }
    }
}

// 清空错题
function clearWrongQuestions() {
    if (wrongQuestions.length === 0) {
        showError('暂无错题记录');
        alert('暂无错题记录');
        return;
    }
    
    if (confirm('确定要清空所有错题记录吗？此操作不可恢复。')) {
        wrongQuestions = [];
        saveToLocalStorage();
        showSuccess('错题记录已清空');
        backFromWrongQuestions();
    }
}

// 清空收藏
function clearFavorites() {
    if (favoriteQuestions.length === 0) {
        showError('暂无收藏题目');
        return;
    }
    
    if (confirm('确定要清空所有收藏题目吗？此操作不可恢复。')) {
        favoriteQuestions = [];
        saveToLocalStorage();
        updateFavoriteButton(); // 更新当前题目的收藏状态
        showSuccess('收藏题目已清空');
        backFromFavorites();
    }
}

// 返回主界面
function backFromWrongQuestions() {
    document.getElementById('wrongQuestionsSection').style.display = 'none';
    
    if (previousSection === 'results') {
        document.getElementById('resultsSection').style.display = 'block';
    } else {
        document.getElementById('homeSection').style.display = 'block';
    }
}

function backFromFavorites() {
    document.getElementById('favoritesSection').style.display = 'none';
    
    if (previousSection === 'results') {
        document.getElementById('resultsSection').style.display = 'block';
    } else {
        document.getElementById('homeSection').style.display = 'block';
    }
}

// 切换得分显示
function toggleScoreDisplay() {
    const scoreDisplay = document.getElementById('scoreDisplay');
    const toggleBtn = document.getElementById('scoreToggleBtn');
    
    if (scoreDisplay.style.display === 'none') {
        scoreDisplay.style.display = 'block';
        toggleBtn.textContent = '📊 隐藏得分';
    } else {
        scoreDisplay.style.display = 'none';
        toggleBtn.textContent = '📊 显示得分';
    }
}

// 导出错题数据
function exportWrongQuestions() {
    if (wrongQuestions.length === 0) {
        showError('暂无错题数据可导出');
        return;
    }
    
    const data = {
        type: 'wrongQuestions',
        exportTime: new Date().toISOString(),
        data: wrongQuestions
    };
    
    downloadJSON(data, `错题数据_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`);
    showSuccess('错题数据导出成功');
}

// 导出收藏题目数据
function exportFavorites() {
    if (favoriteQuestions.length === 0) {
        showError('暂无收藏题目可导出');
        return;
    }
    
    const data = {
        type: 'favoriteQuestions',
        exportTime: new Date().toISOString(),
        data: favoriteQuestions
    };
    
    downloadJSON(data, `收藏题目_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`);
    showSuccess('收藏题目导出成功');
}

// 导出所有数据
function exportAllData() {
    const data = {
        type: 'allData',
        exportTime: new Date().toISOString(),
        data: {
            wrongQuestions: wrongQuestions,
            favoriteQuestions: favoriteQuestions,
            customParseRules: customParseRules,
            questionTypeScores: questionTypeScores
        }
    };
    
    downloadJSON(data, `考试系统数据_${new Date().toLocaleDateString().replace(/\//g, '-')}.json`);
    showSuccess('所有数据导出成功');
}

// 下载JSON文件
function downloadJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 导入数据
function importData() {
    const fileInput = document.getElementById('dataFileInput');
    fileInput.click();
}

// 处理导入的数据文件
function handleDataImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.json')) {
        showError('请选择JSON格式的数据文件');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            
            if (!importedData.type || !importedData.data) {
                showError('数据文件格式不正确');
                return;
            }
            
            switch (importedData.type) {
                case 'wrongQuestions':
                    wrongQuestions = [...wrongQuestions, ...importedData.data];
                    // 去重
                    wrongQuestions = wrongQuestions.filter((question, index, self) => 
                        index === self.findIndex(q => q.id === question.id)
                    );
                    showSuccess(`成功导入 ${importedData.data.length} 道错题`);
                    break;
                    
                case 'favoriteQuestions':
                    favoriteQuestions = [...favoriteQuestions, ...importedData.data];
                    // 去重
                    favoriteQuestions = favoriteQuestions.filter((question, index, self) => 
                        index === self.findIndex(q => q.id === question.id)
                    );
                    showSuccess(`成功导入 ${importedData.data.length} 道收藏题目`);
                    break;
                    
                case 'allData':
                    if (importedData.data.wrongQuestions) {
                        wrongQuestions = [...wrongQuestions, ...importedData.data.wrongQuestions];
                        wrongQuestions = wrongQuestions.filter((question, index, self) => 
                            index === self.findIndex(q => q.id === question.id)
                        );
                    }
                    if (importedData.data.favoriteQuestions) {
                        favoriteQuestions = [...favoriteQuestions, ...importedData.data.favoriteQuestions];
                        favoriteQuestions = favoriteQuestions.filter((question, index, self) => 
                            index === self.findIndex(q => q.id === question.id)
                        );
                    }
                    if (importedData.data.customParseRules) {
                        customParseRules = { ...customParseRules, ...importedData.data.customParseRules };
                    }
                    if (importedData.data.questionTypeScores) {
                        questionTypeScores = { ...questionTypeScores, ...importedData.data.questionTypeScores };
                    }
                    showSuccess('成功导入所有数据');
                    break;
                    
                default:
                    showError('不支持的数据类型');
                    return;
            }
            
            // 保存到本地存储
            saveToLocalStorage();
            
        } catch (error) {
            showError('数据文件解析失败：' + error.message);
        }
    };
    
    reader.readAsText(file);
    
    // 清空文件输入
    event.target.value = '';
}

// 清除本地存储数据
function clearLocalStorage() {
    if (confirm('确定要清除所有本地数据吗？\n\n这将删除：\n• 错题记录\n• 收藏题目\n• 考试进度\n• 自定义设置\n\n此操作不可恢复！')) {
        try {
            // 清除所有localStorage数据
            localStorage.clear();
            
            // 重置内存中的数据
            wrongQuestions = [];
            favoriteQuestions = [];
            currentWrongQuestions = [];
            
            // 重置自定义解析规则为默认值
            customParseRules = {
                questionMarker: '[Q]',
                optionMarker: '[A-F]',
                answerMarker: '[T]',
                questionSeparator: '[J]'
            };
            
            // 清除考试进度
            clearExamProgress();
            
            // 显示成功消息
            showSuccess('本地数据已清除完成！');
            
            // 如果当前在错题回看或收藏界面，返回主页
            const wrongSection = document.getElementById('wrongQuestionsSection');
            const favoritesSection = document.getElementById('favoritesSection');
            
            if (wrongSection && wrongSection.style.display !== 'none') {
                backFromWrongQuestions();
            }
            if (favoritesSection && favoritesSection.style.display !== 'none') {
                backFromFavorites();
            }
            
        } catch (error) {
            showError('清除数据时发生错误：' + error.message);
        }
    }
}