const ytdl = require('@distube/ytdl-core');

// 최고 음질을 위한 ytdl 옵션 설정
const getHighQualityOptions = (url) => {
    return {
        filter: 'audioonly',
        quality: 'highestaudio',
        format: 'webm', // WebM/Opus 형식 
        highWaterMark: 1 << 25, // 32MB 버퍼 
        dlChunkSize: 0, // 전체 청크를 한번에 다운로드
        requestOptions: {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        },
        // 최고 품질 오디오 포맷 우선순위
        audioFormat: 'webm/opus',
        begin: 0,
    };
};

// 사용 가능한 최고 품질 포맷 찾기
const getBestAudioFormat = async (url) => {
    try {
        const info = await ytdl.getInfo(url);
        const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
        
        // 품질 우선순위: Opus > AAC > MP4A
        const preferredFormats = [
            'webm/opus',
            'mp4a',
            'aac'
        ];
        
        for (const format of preferredFormats) {
            const found = audioFormats.find(f => f.container === format.split('/')[0]);
            if (found) {
                console.log(`최고 품질 포맷 선택: ${found.container} - ${found.audioBitrate}kbps`);
                return found;
            }
        }
        
        // 최고 비트레이트 포맷 선택
        const bestFormat = audioFormats.reduce((prev, current) => {
            return (prev.audioBitrate > current.audioBitrate) ? prev : current;
        });
        
        console.log(`최고 비트레이트 포맷 선택: ${bestFormat.container} - ${bestFormat.audioBitrate}kbps`);
        return bestFormat;
    } catch (error) {
        console.error('포맷 정보 가져오기 실패:', error);
        return null;
    }
};

// FFmpeg 고급 설정
const getFFmpegOptions = () => {
    return [
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-af', 'volume=0.8,dynaudnorm=f=200:g=3:r=0.3', // 다이나믹 노멀라이제이션 + 볼륨 조절
    ];
};

// 오디오 리소스 생성 시 최적 설정
const createOptimalAudioResource = (stream) => {
    const { createAudioResource } = require('@discordjs/voice');
    
    return createAudioResource(stream, {
        inputType: 'webm/opus', // Discord 네이티브 코덱
        inlineVolume: true, // 실시간 볼륨 조절
        silencePaddingFrames: 5, // 오디오 끊김 방지
        metadata: {
            title: 'High Quality Audio Stream'
        }
    });
};

// 스트림 에러 핸들링 및 재시도 로직
const createRobustStream = async (url, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`스트림 생성 시도 ${attempt}/${maxRetries}`);
            const options = getHighQualityOptions(url);
            const stream = ytdl(url, options);
            
            // 스트림 에러 핸들링
            stream.on('error', (error) => {
                console.error(`스트림 에러 (시도 ${attempt}):`, error.message);
            });
            
            return stream;
        } catch (error) {
            console.error(`스트림 생성 실패 (시도 ${attempt}):`, error.message);
            if (attempt === maxRetries) {
                throw new Error(`${maxRetries}번 시도 후 스트림 생성 실패`);
            }
            // 잠시 대기 후 재시도
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
};

module.exports = {
    getHighQualityOptions,
    getBestAudioFormat,
    getFFmpegOptions,
    createOptimalAudioResource,
    createRobustStream
};
