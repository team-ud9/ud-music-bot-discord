const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytpl = require('ytpl');
const { getHighQualityOptions, getBestAudioFormat, createOptimalAudioResource, createRobustStream } = require('./audio-config');
require('dotenv').config();

// 봇 설정
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// 서버별 큐 관리
const serverQueues = new Map();

// 큐 클래스
class Queue {
    constructor(textChannel, voiceChannel) {
        this.textChannel = textChannel;
        this.voiceChannel = voiceChannel;
        this.connection = null;
        this.player = null;
        this.songs = [];
        this.volume = 0.5;
        this.playing = false;
    }
}

// 봇 준비 이벤트
client.once('ready', () => {
    console.log(`${client.user.tag}가 온라인 상태입니다!`);
    client.user.setActivity('🎵 !유튜브재생 [URL]', { type: ActivityType.Listening });
});

// 메시지 이벤트
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const serverQueue = serverQueues.get(message.guild.id);
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
client.on('voiceStateUpdate', (oldState, newState) => {
    const guildId = oldState.guild.id;
    const queue = serverQueues.get(guildId);
    if (!queue || !queue.connection) return;

    const channel = oldState.channel;
    if (!channel || channel.id !== queue.voiceChannel.id) return;

    const nonBotMembers = channel.members.filter(member => !member.user.bot);

    // 모두 퇴장한 경우
    if (nonBotMembers.size === 0) {
        queue.player.stop();
        queue.connection.destroy();
        serverQueues.delete(guildId);

        queue.textChannel.send({
            embeds: [new EmbedBuilder()
                .setColor('#FF9900')
                .setTitle('👋 모두 퇴장')
                .setDescription('모든 사용자가 음성 채널을 떠났습니다. 음악 재생을 종료합니다.')
                .setTimestamp()]
        });
        return;
    }

    // 개별 유저 퇴장 처리
    const leftUserTag = oldState.member.user.tag;
    const currentSong = queue.songs[0];

    // 대기열에서 해당 유저가 요청한 곡 삭제
    const before = queue.songs.length;
    queue.songs = queue.songs.filter(song => song.requestedBy !== leftUserTag);
    const removed = before - queue.songs.length;

    if (removed > 0) {
        queue.textChannel.send({
            embeds: [new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('🗑️ 곡 제거')
                .setDescription(`${leftUserTag} 사용자의 곡 ${removed}개를 대기열에서 제거했습니다.`)
                .setTimestamp()]
        });
    }

    // 현재 곡도 해당 유저가 요청했으면 건너뜀
    if (currentSong?.requestedBy === leftUserTag) {
        queue.player.stop();
    }
});

    try {
        switch (command) {
            case '유튜브재생':
            case 'play':
                await execute(message, serverQueue, args);
                break;
            case '건너뛰기':
            case 'skip':
                await skip(message, serverQueue);
                break;
            case '정지':
            case 'stop':
                await stop(message, serverQueue);
                break;
            case '대기열':
            case 'queue':
                await showQueue(message, serverQueue);
                break;
            case '일시정지':
            case 'pause':
                await pause(message, serverQueue);
                break;
            case '재개':
            case 'resume':
                await resume(message, serverQueue);
                break;
            case '볼륨':
            case 'volume':
                await setVolume(message, serverQueue, args);
                break;
            case '셔플':
            case 'shuffle':
                await shuffle(message, serverQueue);
                break;
            case '도움말':
            case 'help':
                await showHelp(message);
                break;
            case '볼륨':
            case 'volume':
                await setVolume(message, serverQueue, args);
                break;
            case '강제종료':
            case 'forceleave':
                await forceLeave(message, serverQueue);
                break;
        }
    } catch (error) {
        console.error('명령어 처리 중 오류:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류 발생')
            .setDescription('명령어 처리 중 오류가 발생했습니다.')
            .setTimestamp();
        message.channel.send({ embeds: [errorEmbed] });
    }
});

// 음악 재생 함수
async function execute(message, serverQueue, args) {
    const voiceChannel = message.member.voice.channel;
    
    if (!voiceChannel) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('먼저 음성 채널에 접속해주세요!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 권한 오류')
            .setDescription('음성 채널에 접속하거나 말할 권한이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    if (!args.length) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ URL 필요')
            .setDescription('YouTube URL을 입력해주세요!\n예시: `!유튜브재생 https://www.youtube.com/watch?v=...`')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    const url = args[0];
    
    if (!ytdl.validateURL(url) && !ytpl.validateID(url)) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 잘못된 URL')
            .setDescription('올바른 YouTube URL을 입력해주세요!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    const loadingEmbed = new EmbedBuilder()
        .setColor('#FFFF00')
        .setTitle('⏳ 로딩 중...')
        .setDescription('음악을 로드하고 있습니다...')
        .setTimestamp();
    const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

    try {
        let songs = [];
        
        // 플레이리스트 처리
        if (ytpl.validateID(url)) {
            const playlist = await ytpl(url);
            for (const item of playlist.items) {
                if (ytdl.validateURL(item.shortUrl)) {
                    const songInfo = await ytdl.getInfo(item.shortUrl);
                    songs.push({
                        title: songInfo.videoDetails.title,
                        url: item.shortUrl,
                        duration: formatDuration(parseInt(songInfo.videoDetails.lengthSeconds)),
                        thumbnail: songInfo.videoDetails.thumbnails[0]?.url,
                        requestedBy: message.author.tag
                    });
                }
            }
        } else {
            // 단일 비디오 처리
            const songInfo = await ytdl.getInfo(url);
            songs.push({
                title: songInfo.videoDetails.title,
                url: url,
                duration: formatDuration(parseInt(songInfo.videoDetails.lengthSeconds)),
                thumbnail: songInfo.videoDetails.thumbnails[0]?.url,
                requestedBy: message.author.tag
            });
        }

        if (!serverQueue) {
            const queueContruct = new Queue(message.channel, voiceChannel);
            
            serverQueues.set(message.guild.id, queueContruct);
            queueContruct.songs = songs;

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });
                
                queueContruct.connection = connection;
                await loadingMessage.delete();
                play(message.guild, queueContruct.songs[0]);
            } catch (error) {
                console.error('음성 채널 연결 오류:', error);
                serverQueues.delete(message.guild.id);
                const embed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('❌ 연결 오류')
                    .setDescription('음성 채널에 연결할 수 없습니다!')
                    .setTimestamp();
                await loadingMessage.edit({ embeds: [embed] });
            }
        } else {
            serverQueue.songs = serverQueue.songs.concat(songs);
            await loadingMessage.delete();
            
            if (songs.length === 1) {
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('✅ 대기열에 추가됨')
                    .setDescription(`**${songs[0].title}**`)
                    .addFields(
                        { name: '길이', value: songs[0].duration, inline: true },
                        { name: '요청자', value: songs[0].requestedBy, inline: true },
                        { name: '대기열 위치', value: `${serverQueue.songs.length}`, inline: true }
                    )
                    .setThumbnail(songs[0].thumbnail)
                    .setTimestamp();
                message.channel.send({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('✅ 플레이리스트 추가됨')
                    .setDescription(`**${songs.length}**개의 곡이 대기열에 추가되었습니다!`)
                    .setTimestamp();
                message.channel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('음악 로드 오류:', error);
        await loadingMessage.delete();
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 로드 오류')
            .setDescription('음악을 로드할 수 없습니다. URL을 확인해주세요!')
            .setTimestamp();
        message.channel.send({ embeds: [embed] });
    }
}

// 음악 재생
async function play(guild, song) {
    const serverQueue = serverQueues.get(guild.id);
    if (!song) {
        if (serverQueue?.connection) {
            serverQueue.connection.destroy();
        }
        serverQueues.delete(guild.id);

        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('👋 재생 종료')
            .setDescription('대기열이 비어 음성 채널에서 나갔습니다.')
            .setTimestamp();

        serverQueue?.textChannel.send({ embeds: [embed] });
        return;
    }

    try {
        // 최고 품질 포맷 가져오기
        const bestFormat = await getBestAudioFormat(song.url);
        console.log(`재생할 곡: ${song.title}`);
        if (bestFormat) {
            console.log(`선택된 오디오 포맷: ${bestFormat.container} - ${bestFormat.audioBitrate || 'Unknown'}kbps`);
        }

        // 고품질 스트림 생성
        const stream = await createRobustStream(song.url);

        // 오디오 리소스 생성
        const resource = createOptimalAudioResource(stream);
        const player = createAudioPlayer();

        serverQueue.audioResource = resource;
        serverQueue.player = player;
        serverQueue.connection.subscribe(player);
        player.play(resource);
        serverQueue.playing = true;

        // 볼륨 적용
        if (resource.volume) {
            resource.volume.setVolume(serverQueue.volume);
        }

        // 종료 예상 시간 계산
        const songLength = parseDurationToSeconds(song?.duration);
        const nowUnix = Math.floor(Date.now() / 1000);
        const expectedEndUnix = nowUnix + songLength;

        // 재생 중 알림 Embed
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎵 현재 재생 중')
            .setDescription(`**${song.title}**`)
            .addFields(
                { name: '길이', value: `${song.duration} [<t:${expectedEndUnix}:R>]` || '알 수 없음', inline: true },
                { name: '요청자', value: song.requestedBy || '알 수 없음', inline: true },
                { name: '남은 곡', value: `${serverQueue.songs.length - 1}개`, inline: true },
                { name: '오디오 품질', value: bestFormat ? `${bestFormat.container?.toUpperCase()} - ${bestFormat.audioBitrate || 'Unknown'}kbps` : '고품질', inline: true }
            )
            .setThumbnail(song.thumbnail)
            .setTimestamp();

        serverQueue.textChannel.send({ embeds: [embed] });

        // 다음 곡으로 넘어가기
        player.on(AudioPlayerStatus.Idle, () => {
            serverQueue.songs.shift();
            play(guild, serverQueue.songs[0]);
        });

        player.on('error', error => {
            console.error('플레이어 오류:', error);
            serverQueue.songs.shift();
            play(guild, serverQueue.songs[0]);
        });

    } catch (error) {
        console.error('재생 오류:', error);
        serverQueue.songs.shift();
        play(guild, serverQueue.songs[0]);
    }
}

function parseDurationToSeconds(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') return 0;
    const parts = durationStr.split(':').map(Number);
    if (parts.some(isNaN)) return 0;

    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    } else {
        return parts[0];
    }
}

// 건너뛰기
async function skip(message, serverQueue) {
    const isAdmin = message.member.permissions.has('Administrator');
    const isRequester = serverQueue.songs[0]?.requestedBy === message.author.tag;

    if (!(isAdmin || isRequester)) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 권한 부족')
            .setDescription('현재 재생 중인 곡을 요청한 사람 또는 관리자만 건너뛰기 할 수 있습니다.')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }
    
    if (!message.member.voice.channel) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('음성 채널에 접속해주세요!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }
    
    if (!serverQueue) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('재생 중인 음악이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }
    
    serverQueue.player.stop();
    
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('⏭️ 건너뛰기')
        .setDescription('현재 곡을 건너뛰었습니다!')
        .setTimestamp();
    message.channel.send({ embeds: [embed] });
}

// 정지
async function stop(message, serverQueue) {
    if (!message.member.permissions.has('Administrator')) {
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ 권한 부족')
        .setDescription('이 명령어는 서버 관리자만 사용할 수 있습니다.')
        .setTimestamp();
    return message.channel.send({ embeds: [embed] });
    }
    
    if (!message.member.voice.channel) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('음성 채널에 접속해주세요!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    if (!serverQueue) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('재생 중인 음악이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    serverQueue.songs = [];
    serverQueue.player.stop();
    
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('⏹️ 정지')
        .setDescription('음악 재생을 정지하고 대기열을 비웠습니다!')
        .setTimestamp();
    message.channel.send({ embeds: [embed] });
}

// 대기열 표시
async function showQueue(message, serverQueue) {
    if (!serverQueue || !serverQueue.songs.length) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 빈 대기열')
            .setDescription('대기열에 음악이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    const current = serverQueue.songs[0];
    const upcoming = serverQueue.songs.slice(1, 11); // 최대 10개 표시

    let queueText = `**🎵 현재 재생 중:**\n${current.title}\n\n`;
    
    if (upcoming.length > 0) {
        queueText += `**📋 다음 곡들:**\n`;
        upcoming.forEach((song, index) => {
            queueText += `${index + 1}. ${song.title}\n`;
        });
        
        if (serverQueue.songs.length > 11) {
            queueText += `\n그리고 ${serverQueue.songs.length - 11}개의 곡이 더 있습니다...`;
        }
    }

    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('🎶 대기열')
        .setDescription(queueText)
        .addFields(
            { name: '총 곡 수', value: `${serverQueue.songs.length}개`, inline: true },
            { name: '재생 상태', value: serverQueue.playing ? '▶️ 재생 중' : '⏸️ 일시정지', inline: true }
        )
        .setTimestamp();
    
    message.channel.send({ embeds: [embed] });
}

// 일시정지
async function pause(message, serverQueue) {
    const isAdmin = message.member.permissions.has('Administrator');
    const aloneInVC = message.member.voice.channel?.members.filter(m => !m.user.bot).size === 1;
    const isRequester = serverQueue.songs[0]?.requestedBy === message.author.tag;

    if (!(isAdmin || (aloneInVC && isRequester))) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 권한 부족')
            .setDescription('이 명령어는 관리자이거나, 혼자 있을 때 본인이 재생한 곡만 일시정지할 수 있습니다.')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    
    if (!serverQueue || !serverQueue.playing) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('재생 중인 음악이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    serverQueue.player.pause();
    serverQueue.playing = false;
    
    const embed = new EmbedBuilder()
        .setColor('#FFFF00')
        .setTitle('⏸️ 일시정지')
        .setDescription('음악을 일시정지했습니다!')
        .setTimestamp();
    message.channel.send({ embeds: [embed] });
}

// 재개
async function resume(message, serverQueue) {
    const isAdmin = message.member.permissions.has('Administrator');
    const aloneInVC = message.member.voice.channel?.members.filter(m => !m.user.bot).size === 1;
    const isRequester = serverQueue.songs[0]?.requestedBy === message.author.tag;

    if (!(isAdmin || (aloneInVC && isRequester))) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 권한 부족')
            .setDescription('이 명령어는 관리자이거나, 혼자 있을 때 본인이 재생한 곡만 재개할 수 있습니다.')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }
    
    if (!serverQueue || serverQueue.playing) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('일시정지된 음악이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    serverQueue.player.unpause();
    serverQueue.playing = true;
    
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('▶️ 재개')
        .setDescription('음악 재생을 재개했습니다!')
        .setTimestamp();
    message.channel.send({ embeds: [embed] });
}

// 볼륨 조절
async function setVolume(message, serverQueue, args) {
    if (!message.member.voice.channel) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('음성 채널에 접속해주세요!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    if (!serverQueue) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('재생 중인 음악이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    if (!args[0]) {
        const embed = new EmbedBuilder()
            .setColor('#0099FF')
            .setTitle('🔊 현재 볼륨')
            .setDescription(`현재 볼륨: **${Math.round(serverQueue.volume * 100)}%**`)
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    const volume = parseInt(args[0]);
    if (isNaN(volume) || volume < 0 || volume > 200) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 잘못된 볼륨')
            .setDescription('볼륨은 0-200 사이의 숫자여야 합니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    serverQueue.volume = volume / 100;
    if (serverQueue.audioResource?.volume) {
    	serverQueue.audioResource.volume.setVolume(serverQueue.volume);
	}

    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🔊 볼륨 변경')
        .setDescription(`볼륨을 **${volume}%**로 설정했습니다!`)
        .setTimestamp();
    message.channel.send({ embeds: [embed] });
}
async function shuffle(message, serverQueue) {
    if (!message.member.permissions.has('Administrator')) {
    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ 권한 부족')
        .setDescription('이 명령어는 서버 관리자만 사용할 수 있습니다.')
        .setTimestamp();
    return message.channel.send({ embeds: [embed] });
    }
    
    if (!serverQueue || serverQueue.songs.length <= 2) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 오류')
            .setDescription('셔플하기에 충분한 곡이 없습니다!')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    const currentSong = serverQueue.songs.shift();
    
    for (let i = serverQueue.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [serverQueue.songs[i], serverQueue.songs[j]] = [serverQueue.songs[j], serverQueue.songs[i]];
    }
    
    serverQueue.songs.unshift(currentSong);
    
    const embed = new EmbedBuilder()
        .setColor('#9932CC')
        .setTitle('🔀 셔플')
        .setDescription('대기열을 셔플했습니다!')
        .setTimestamp();
    message.channel.send({ embeds: [embed] });
}

async function forceLeave(message, serverQueue) {
    if (!message.member.permissions.has('Administrator')) {
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('❌ 권한 부족')
            .setDescription('이 명령어는 서버 관리자만 사용할 수 있습니다.')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    const connection = getVoiceConnection(message.guild.id);
    if (!connection) {
        const embed = new EmbedBuilder()
            .setColor('#FF9900')
            .setTitle('📭 연결 없음')
            .setDescription('현재 봇은 음성 채널에 접속해 있지 않습니다.')
            .setTimestamp();
        return message.channel.send({ embeds: [embed] });
    }

    // 재생 중단 및 대기열 초기화
    if (serverQueue?.player) {
        serverQueue.player.stop();
    }

    if (serverQueue?.songs) {
        serverQueue.songs = [];
    }

    connection.destroy();
    serverQueues.delete(message.guild.id);

    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🛑 강제 종료')
        .setDescription('음성 채널에서 퇴장하고 모든 재생 정보를 초기화했습니다.')
        .setTimestamp();

    message.channel.send({ embeds: [embed] });
}

// 도움말
async function showHelp(message) {
    const embed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('🎵 뮤직봇 명령어')
        .setDescription('사용 가능한 모든 명령어입니다:')
        .addFields(
            { name: '!유튜브재생 <URL>', value: 'YouTube 음악 재생', inline: false },
            { name: '!건너뛰기', value: '현재 곡 건너뛰기', inline: true },
            { name: '!정지', value: '재생 정지 및 대기열 비우기', inline: true },
            { name: '!대기열', value: '현재 대기열 확인', inline: true },
            { name: '!일시정지', value: '음악 일시정지', inline: true },
            { name: '!재개', value: '음악 재생 재개', inline: true },
            { name: '!셔플', value: '대기열 섞기', inline: true },
            { name: '!볼륨 <볼륨숫자>', value: '음악 소리 조정', inline: true },
            { name: '!도움말', value: '이 도움말 표시', inline: true }
        )
        .setFooter({ text: '고음질 음악을 즐기세요! 🎶' })
        .setTimestamp();
    
    message.channel.send({ embeds: [embed] });
}

// 시간 포맷팅 함수
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

// 봇 로그인
client.login(process.env.DISCORD_BOT_TOKEN);
