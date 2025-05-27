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

// ChatGPT 응답 생성 함수 (intro/last 분리)
async function generateEncouragement(data, type = 'intro') {
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
      return getRandomSentence(path.join(__dirname, 'sentence', 'intro_sentence.json'));
    } else {
      return getRandomSentence(path.join(__dirname, 'sentence', '\u0008last_sentence.json'));
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

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

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
    const intro = await generateEncouragement(timeData.weekly, 'intro');
    // ChatGPT 응답 생성 (마무리)
    const last = await generateEncouragement(timeData.weekly, 'last');
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
      content: `### **🫧 과제완료**\n${taskList.join('\n')}\n### **🫧 이만큼의 마무리**\n>  ** 오늘은 ${todayMembers}과 ${timeStr}을 함께 했어요. ** \n> ${last}`
    });
  }
});

client.login(process.env.DISCORD_TOKEN); 