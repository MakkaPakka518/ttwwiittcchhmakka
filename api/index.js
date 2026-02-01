export const config = {
  runtime: 'edge', 
};

export default async function handler(request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  
  let channel = params.get('channel');
  const format = params.get('format') || 'm3u'; 

  if (!channel) return new Response("Error: No channel", { status: 400 });

  // 清洗参数
  channel = channel.replace('.txt', '').replace('.m3u', '').replace('/', '');
  if (channel.includes('twitch.tv/')) {
    channel = channel.split('twitch.tv/')[1].split('/')[0];
  }

  try {
    // 1. 获取 Token (使用 Switch 伪装)
    const tokenData = await getTwitchAccessToken(channel);

    // 2. 失败处理
    if (!tokenData) {
      // 可以在 Vercel Logs 里看到这行字，说明 IP 被墙或者 ID 没过
      console.error(`[FAIL] Could not get token for ${channel}`);
      
      const msg = `[OFFLINE/BLOCKED] Could not fetch data for '${channel}'. Try again later.`;
      if (format === 'txt') {
         return new Response(msg, { status: 200 });
      }
      return new Response(msg, { status: 404 });
    }

    // 3. 成功，拼接链接
    const randomInt = Math.floor(Math.random() * 1000000);
    const m3u8Url = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?client_id=jzkbprff40iqj646a697cyrvl0zt2m6&token=${tokenData.value}&sig=${tokenData.signature}&allow_source=true&allow_audio_only=true&p=${randomInt}`;

    // 4. 返回
    if (format === 'txt') {
      return new Response(m3u8Url, { 
        status: 200, 
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' } 
      });
    } else {
      const m3uContent = `#EXTM3U\n#EXTINF:-1 tvg-id="${channel}" tvg-name="${channel}" tvg-logo="https://static-cdn.jtvnw.net/ttv-boxart/${channel}-285x380.jpg" group-title="Twitch",${channel}\n${m3u8Url}`;
      return new Response(m3uContent, { 
        status: 200, 
        headers: { 'Content-Type': 'application/x-mpegurl', 'Cache-Control': 'no-cache' } 
      });
    }

  } catch (error) {
    return new Response(`Server Error: ${error.message}`, { status: 500 });
  }
}

// 核心修改：伪装成 Nintendo Switch 客户端
async function getTwitchAccessToken(channel) {
  // Nintendo Switch 的 Client ID (这个 ID 权限很高，不容易被墙)
  const CLIENT_ID = 'jzkbprff40iqj646a697cyrvl0zt2m6'; 
  
  const queryStr = `
    query PlaybackAccessToken( $login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String! ) {
      streamPlaybackAccessToken(channelName: $login, params: {platform: "switch", playerBackend: "mediaplayer", playerType: $playerType}) {
        value
        signature
      }
    }
  `;

  const body = {
    operationName: "PlaybackAccessToken",
    variables: {
      isLive: true,
      login: channel,
      isVod: false,
      vodID: "",
      playerType: "embed" // switch 通常配合 embed 或 site 使用
    },
    query: queryStr
  };

  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      'Content-Type': 'application/json',
      // 关键伪装：假装自己是 Dalvik (安卓底层)，这是 Switch 系统的一部分特征
      'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 9; Nintendo Switch Build/NF1)',
      'Referer': 'https://www.twitch.tv/', 
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  
  // 打印详细错误到 Vercel 日志 (用于排查)
  if (data.errors) {
    console.log("Twitch API Refused:", JSON.stringify(data.errors));
  }

  if (data.data && data.data.streamPlaybackAccessToken) {
    return data.data.streamPlaybackAccessToken;
  }
  
  return null;
}
