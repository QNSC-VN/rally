import type { entityRefTypeEnum } from '../../../../../db/schema/enums';

/**
 * What a comment hangs off. Derived from the database enum so the two cannot drift — the
 * same lesson `ActivityEntityType` taught when it was hand-maintained.
 */
export type CommentEntityType = (typeof entityRefTypeEnum.enumValues)[number];

/** The subject of a comment thread: which kind of thing, and which one. */
export interface CommentRef {
  entityType: CommentEntityType;
  entityId: string;
}

export interface Comment {
  id: string;
  workspaceId: string;
  entityType: CommentEntityType;
  entityId: string;
  authorId: string;
  body: string;
  parentId: string | null;
  isEdited: boolean;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCommentInput {
  id: string;
  workspaceId: string;
  entityType: CommentEntityType;
  entityId: string;
  authorId: string;
  body: string;
  parentId?: string;
}
