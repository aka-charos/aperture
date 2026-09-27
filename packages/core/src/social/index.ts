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
  type SocialMediaType,
  type SocialItemRef,
  type SocialRecommendationItem,
  type RecommendationGroup,
  type RecipientAssessment,
  type RecommendOutcome,
} from './recommendations.js'

export { displayNameSql, visibleConnectionsSql, type SkipReason } from './rules.js'
