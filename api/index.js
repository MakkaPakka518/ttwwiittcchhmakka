export const config = {
  runtime: 'edge', 
};

export default async function handler(request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  
  // 获取频道参数
  let channel = params.get('channel');
  const format = params.get('format') || 'm3u'; 

  // --- 1. 参数清洗与容错 ---
  if (!channel) return new Response("Error: Missing channel param", { status: 400 });

  // 忽略浏览器自动请求的图标
  if (channel.includes('favicon')) return new Response(null, { status: 404 });

  // 如果频道名里意外包含了后缀（路由匹配偏差时），手动去掉
  channel = channel.replace('.txt', '').replace('.m3u', '').replace('/', '');

  // 兼容完整 URL (如 twitch.tv/shroud)
  if (channel.includes('twitch.tv/')) {
    channel = channel.split('twitch.tv/')[1].split('/')[0];
  }

  try {
    // --- 2. 请求 Twitch API 获取 Token ---
    const tokenData = await getTwitchAccessToken(channel);

    // --- 3. 结果处理 ---
    
    // 情况 A: 没拿到 Token (通常是主播不在线，或者被封禁)
    if (!tokenData) {
      const msg = `[OFFLINE] Channel '${channel}' is currently not live or does not exist.`;
      
      // 如果请求的是 txt 格式，返回 200 状态码和提示文字，方便浏览器查看
      if (format === 'txt') {
        return new Response(msg, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      // 如果是 m3u 格式，返回 404 告诉播放器无法播放
      return new Response(msg, { status: 404 });
    }

    // 情况 B: 拿到 Token (主播在线) -> 拼接真实播放地址
    const randomInt = Math.floor(Math.random() * 1000000);
    const m3u8Url = `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?client_id=kimne78a6xlas1qlcj9435f1q4F&token=${tokenData.value}&sig=${tokenData.signature}&allow_source=true&allow_audio_only=true&p=${randomInt}`;

    // --- 4. 返回最终数据 ---
    if (format === 'txt') {
      // txt 格式：直接返回链接字符串
      return new Response(m3u8Url, { 
        status: 200, 
        headers: { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        } 
      });
    } else {
      // m3u 格式：返回标准 IPTV 列表
      const m3uContent = `#EXTM3U\n#EXTINF:-1 tvg-id="${channel}" tvg-name="${channel}" tvg-logo="https://static-cdn.jtvnw.net/ttv-boxart/${channel}-285x380.jpg" group-title="Twitch",${channel}\n${m3u8Url}`;
      return new Response(m3uContent, { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/x-mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        } 
      });
    }

  } catch (error) {
    return new Response(`Server Error: ${error.message}`, { status: 500 });
  }
}

// 辅助函数：获取 AccessToken (纯文本 Query 版)
async function getTwitchAccessToken(channel) {
  const CLIENT_ID = 'kimne78a6xlas1qlcj9435f1q4F'; 
  
  // GraphQL 查询语句
  const queryStr = `
    query PlaybackAccessToken( $login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String! ) {
      streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) {
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
      playerType: "site"
    },
    query: queryStr
  };

  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      'Content-Type': 'application/json',
      // 模拟 Chrome 浏览器，降低被屏蔽风险
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
      'Referer': 'https://www.twitch.tv/',
      'Origin': 'https://www.twitch.tv'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  
  // 如果 API 返回数据结构正确，提取 token
  if (data.data && data.data.streamPlaybackAccessToken) {
    return data.data.streamPlaybackAccessToken;
  }
  
  return null;
}
