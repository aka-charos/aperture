/**
 * Video quality mapping shared by the Emby and Jellyfin mappers.
 *
 * Both servers return MediaStreams inside each MediaSources entry when the
 * item request includes Fields=MediaSources, with the same Type/Codec/Width/Height shape.
 */

export interface VideoQualitySource {
  Container?: string
  MediaStreams?: Array<{
    Type: string // Video, Audio, Subtitle
    Codec?: string
    Width?: number
    Height?: number
  }>
}

export function mapVideoQuality(primarySource: VideoQualitySource | undefined) {
  const videoStream = primarySource?.MediaStreams?.find((s) => s.Type === 'Video')
  const audioStream = primarySource?.MediaStreams?.find((s) => s.Type === 'Audio')

  return {
    videoResolution:
      videoStream?.Width && videoStream?.Height
        ? `${videoStream.Width}x${videoStream.Height}`
        : undefined,
    videoCodec: videoStream?.Codec,
    audioCodec: audioStream?.Codec,
    container: primarySource?.Container,
  }
}
