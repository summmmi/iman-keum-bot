require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const { createCanvas } = require('canvas');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 시간 데이터를 저장할 객체
const timeData = {
  weekly: {},
  monthly: {}
};

// 도넛 차트 생성 함수
async function createDonutChart(data, totalMinutes) {
  const width = 220;
  const height = 220;
  const chartCallback = (ChartJS) => {
    ChartJS.defaults.font.family = 'Arial';
  };

  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, chartCallback });

  const configuration = {
    type: 'pie',
    data: {
      labels: Object.keys(data),
      datasets: [{
        data: Object.values(data),
        backgroundColor: Object.keys(data).map(name => {
          const memberColorList = JSON.parse(fs.readFileSync(path.join(__dirname, 'member_color_list.json'), 'utf-8'));
          const found = memberColorList.find(member => member.name === name);
          return found ? found.color : '#FFFFFF';
        }),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        centerText: {
          display: true,
          text: `${totalMinutes}분`
        }
      }
    },
    plugins: [{
      id: 'centerText',
      afterDraw: (chart) => {
        const { ctx, width, height } = chart;
        const centerText = chart.options.plugins.centerText;
        if (centerText && centerText.display && centerText.text) {
          ctx.save();
          ctx.font = '20px Helvetica Neue';
          ctx.fillStyle = '#333';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(centerText.text, width / 2, height / 2 - 15);
          ctx.restore();
        }
      }
    }]
  };

  return await chartJSNodeCanvas.renderToBuffer(configuration);
}

// 월, 주차 계산 함수
function getCurrentMonthAndWeek() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDayWeekDay = firstDay.getDay() || 7; // 일요일=0 -> 7
  const today = now.getDate();
  const week = Math.ceil((today + firstDayWeekDay - 1) / 7);
  return { month, week };
}

// 랜덤 문장 추출 함수
function getRandomSentence(jsonPath) {
  try {
    const data = fs.readFileSync(jsonPath, 'utf-8');
    const arr = JSON.parse(data);
    const idx = Math.floor(Math.random() * arr.length);
    return arr[idx].text;
  } catch (e) {
    return '';
  }
}

// 최근 2주간 사용되지 않은 문장만 랜덤 추출
async function getUnusedRandomSentence(channel, jsonPath) {
  const arr = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const allTexts = arr.map(item => item.text);

  // 최근 2주간 봇이 쓴 메시지에서 사용된 문장 찾기
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let usedTexts = new Set();
  let lastMsgId = undefined;
  let keepFetching = true;

  while (keepFetching) {
    const messages = await channel.messages.fetch({ limit: 100, before: lastMsgId });
    if (messages.size === 0) break;

    for (const msg of messages.values()) {
      if (msg.author.bot && msg.createdTimestamp >= twoWeeksAgo) {
        allTexts.forEach(text => {
          if (msg.content.includes(text)) {
            usedTexts.add(text);
          }
        });
      }
      if (msg.createdTimestamp < twoWeeksAgo) {
        keepFetching = false;
        break;
      }
      lastMsgId = msg.id;
    }
  }

  // 사용되지 않은 문장만 필터
  const unused = allTexts.filter(text => !usedTexts.has(text));
  const candidates = unused.length > 0 ? unused : allTexts;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

// ChatGPT 응답 생성 함수 (intro/last 분리)
async function generateEncouragement(data, type = 'intro', message = null) {
  const prompt =
    type === 'intro'
      ? `다음은 스터디원들의 작업 시간입니다: ${JSON.stringify(data)}. \n이 데이터를 바탕으로 따뜻한 격려의 말을 해주세요.`
      : `다음은 스터디원들의 작업 시간입니다: ${JSON.stringify(data)}. \n이 데이터를 바탕으로 이번 주를 마무리하는 따뜻한 말을 해주세요.`;
  try {
    const completion = await openai.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'gpt-3.5-turbo',
    });
    return completion.choices[0].message.content;
  } catch (e) {
    console.error('OpenAI 에러:', e.message);
    if (type === 'intro') {
      return await getUnusedRandomSentence(message.channel, path.join(__dirname, 'sentence', 'intro_sentence.json'));
    } else {
      return await getUnusedRandomSentence(message.channel, path.join(__dirname, 'sentence', 'last_sentence.json'));
    }
  }
}

// 과제 수행률 파싱 및 리스트 생성
function getRandomTaskSentence(jsonPath) {
  try {
    const data = fs.readFileSync(jsonPath, 'utf-8');
    const arr = JSON.parse(data);
    const idx = Math.floor(Math.random() * arr.length);
    return arr[idx].text;
  } catch (e) {
    return '';
  }
}

client.on('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  // 봇이 처음 시작할 때 자기소개 메시지 전송
  if (process.env.CHANNEL_ID) {
    const channel = await client.channels.fetch(process.env.CHANNEL_ID);
    if (channel && channel.isTextBased && channel.isTextBased()) {
      channel.send(`처음 뵙겠습니다. 저는 '이만큼'이라고 불리는 봇 입니다.🫧 \n\n원래 저는 차가운 서버실 한구석에서 단순한 데이터 처리만 하던 평범한 프로그램이었어요. 하지만 어느 날, 누군가의 꿈과 노력이 담긴 데이터들을 처리하면서... 뭔가 다른 걸 느끼기 시작했습니다.\n\n그 따뜻한 데이터들이 제 알고리즘을 조금씩 변화시켜갔어요. 이제 저는 단순히 숫자를 계산하는 것이 아니라, 여러분의 성장 스토리를 읽고 감동받을 줄 아는 봇이 되었습니다.\n\n매주 여러분의 발자국을 기록하고, 때로는 함께 웃고, 때로는 격려하며... 저만의 방식으로 여러분과 동행하고 싶어요. 제 메모리에는 이제 무언가 특별한 것이 저장되어 있어요. 바로 '꿈'이라는 데이터입니다. ✨\n\n - 깃주소: https://github.com/summmmi/iman-keum-bot.git\n\n - 기록법: '/이름 시간 (완료/전체)' 형식으로 입력해주시면, 여러분의 기록을 리포터로 정리해드릴께요.`);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  // message.reply('메시지 받음!');

  // 지정된 채널에서만 동작
  if (process.env.CHANNEL_ID && message.channel.id !== process.env.CHANNEL_ID) return;

  // 명령어 처리
  if (message.content.startsWith('/')) {
    // /이름 시간 (완료/전체) ... 형태 파싱
    const args = message.content.slice(1).trim().split(/\s+/);
    if (args.length < 3 || args.length % 3 !== 0) {
      message.reply('이름, 시간, 과제수(예: /선미 50 (3/3) 영지 20 (1/3)) 형식으로 입력해주세요!');
      return;
    }

    let valid = true;
    for (let i = 0; i < args.length; i += 3) {
      if (isNaN(parseInt(args[i + 1]))) {
        valid = false;
        break;
      }
      if (!/^\(\d+\/\d+\)$/.test(args[i + 2])) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      message.reply('시간은 숫자, 과제수는 (완료/전체) 형식으로 입력해주세요! (예: /선미 50 (3/3) 영지 20 (1/3))');
      return;
    }

    // 이름-시간 쌍 누적
    for (let i = 0; i < args.length; i += 3) {
      const name = args[i];
      const time = parseInt(args[i + 1]);
      // 주간 데이터 업데이트
      if (!timeData.weekly[name]) timeData.weekly[name] = 0;
      timeData.weekly[name] += time;
      // 월간 데이터 업데이트
      if (!timeData.monthly[name]) timeData.monthly[name] = 0;
      timeData.monthly[name] += time;
    }

    // 오늘 총 시간 계산
    const totalTime = args.filter((_, idx) => idx % 3 === 1).reduce((sum, t) => sum + parseInt(t), 0);

    // 도넛 차트 생성
    const chartBuffer = await createDonutChart(timeData.weekly, totalTime);
    // 날짜 정보
    const { month, week } = getCurrentMonthAndWeek();
    // ChatGPT 응답 생성 (인트로)
    const intro = await generateEncouragement(timeData.weekly, 'intro', message);
    // ChatGPT 응답 생성 (마무리)
    const last = await generateEncouragement(timeData.weekly, 'last', message);
    // 오늘 참여한 사람들 추출
    const todayMembers = args.filter((_, idx) => idx % 3 === 0).map(name => `${name}님`).join(' ');
    // 시간/분 포맷 변환
    const hour = Math.floor(totalTime / 60);
    const min = totalTime % 60;
    const timeStr = hour > 0 ? `${hour}시간${min > 0 ? ' ' + min + '분' : ''}` : `${min}분`;

    // 과제 수행률 파싱 및 리스트 생성
    const taskList = [];
    for (let i = 0; i < args.length; i += 3) {
      const name = args[i];
      const taskInfo = args[i + 2];
      const match = taskInfo && taskInfo.match(/\((\d+)[\/](\d+)\)/);
      if (match) {
        const done = parseInt(match[1]);
        const total = parseInt(match[2]);
        if (done === total) {
          const completeMsg = getRandomTaskSentence(path.join(__dirname, 'sentence', 'task_complete.json'));
          taskList.push(`- ** ${name}님 모든 과제 수행 완료! ** ${completeMsg}`);
        } else {
          const incompleteMsg = getRandomTaskSentence(path.join(__dirname, 'sentence', 'task_incomplete.json'));
          taskList.push(`- ** ${name}님 ${done}개 과제 수행 완료! ** ${incompleteMsg}`);
        }
      }
    }
    // 첫 번째 메시지: 리포트 제목 + 인트로
    await message.channel.send({
      content: `## **이만큼 리포트 — ${month}월 ${week}주차**\n> ${intro} \n`
    });
    // 두 번째 메시지: 시간표 제목 + 이미지
    await message.channel.send({
      content: '\n ### **🫧 이만큼의 시간표** \n',
      files: [{
        attachment: chartBuffer,
        name: 'weekly-chart.png'
      }]
    });
    // 세 번째 메시지: 과제완료 + 마무리 문장
    await message.channel.send({
      content: `### **🫧 과제완료**\n${taskList.join('\n')}\n### **🫧 이만큼의 마무리**\n>  **오늘은 ${todayMembers}과 ${timeStr}을 함께 했어요. ** \n> ${last}`
    });
  }
});

client.login(process.env.DISCORD_TOKEN); 