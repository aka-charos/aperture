import type { ReactNode } from 'react'
import {
  ContentCarouselSkeleton,
  ContentDetailSkeleton,
  PersonResultSkeleton,
  StatsSkeleton,
  StudiosSkeleton,
} from './ToolSkeletons'

export function getToolSkeleton(toolName: string): ReactNode {
  switch (toolName) {
    // Content carousel tools
    case 'searchContent':
    case 'findSimilarContent':
    case 'getMyRecommendations':
    case 'getWatchHistory':
    case 'getUserRatings':
    case 'getUnwatched':
    case 'getContentRankings':
      return <ContentCarouselSkeleton />

    // Single-title views. The analysis card shares the detail skeleton rather
    // than the carousel one the default would give it — a row of poster
    // placeholders promises a list and then resolves into one article.
    case 'getContentDetails':
    case 'getTitleAnalysis':
      return <ContentDetailSkeleton />

    // Person search
    case 'searchPeople':
      return <PersonResultSkeleton />

    // Stats
    case 'getLibraryStats':
      return <StatsSkeleton />

    // Studios/networks
    case 'getTopStudios':
    case 'getTopNetworks':
      return <StudiosSkeleton />

    // Default - generic loading skeleton
    default:
      return <ContentCarouselSkeleton />
  }
}
