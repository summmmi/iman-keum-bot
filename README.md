# 이만큼 디스코드 봇

스터디원들의 작업 시간을 관리하고 시각화하는 디스코드 봇입니다.

## 기능

- 주간 작업 시간 기록 및 파이 차트 시각화
- ChatGPT를 활용한 따뜻한 격려 메시지 생성
- 월간 총결산 기능

## 설치 방법

1. 저장소 클론
```bash
git clone [repository-url]
cd iman-keum-bot
```

2. 의존성 설치
```bash
npm install
```

3. 환경 변수 설정
`.env` 파일을 생성하고 다음 내용을 추가합니다:
```
DISCORD_TOKEN=your_discord_token_here
OPENAI_API_KEY=your_openai_api_key_here
```

## 사용 방법

1. 봇 실행
```bash
npm start
```

2. 디스코드에서 명령어 사용
- 작업 시간 및 테스크 완료 비율 기록: `/선미 50 (3/3)` 또는 `/유진 30 (2/3)` 
- 괄호 안의 숫자는 complete task/total task
- 봇이 자동으로 파이 차트를 생성하고 격려 메시지를 보냅니다.

## 기술 스택

- Discord.js
- Chart.js
- OpenAI API
- Node.js 