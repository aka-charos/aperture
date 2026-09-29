/**
 * Social layer: admin-managed connections and peer recommendations.
 * Design record: docs/plans/social-connections.md.
 */

export {
  avatarUrlFor,
  createUserConnection,
  removeUserConnection,
  listAllConnections,
  listVisibleConnections,
  getVisibleConnectionIds,
  isVisibleConnection,
  SocialUserNotFoundError,
  type ConnectedUser,
  type ConnectionEnd,
  type ConnectionPair,
} from './connections.js'

export {
  assessRecipients,
  recommendItemToUsers,
  listInbox,
  countInbox,
  dismissRecommendation,
  listSent,
  countSent,
  type SocialMediaType,
  type SocialItemRef,
  type SocialRecommendationItem,
  type RecommendationGroup,
  type RecipientAssessment,
  type RecommendOutcome,
  type SentRecommendationItem,
  type SentGroup,
} from './recommendations.js'

export { displayNameSql, visibleConnectionsSql, type SentStatus, type SkipReason } from './rules.js'
