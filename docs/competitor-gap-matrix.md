# Competitor Gap Matrix (telegram.v2)

This matrix maps the referenced Telegram MCP feature groups to `telegram.v2.*` operations in this repository.

## Capability Mapping

| Capability Group | Competitor Claim | telegram.v2 Mapping |
|---|---|---|
| Chat/group/channel management | Create, edit, invite, leave, admin and ban flows | `telegram.v2.chats` operations: `create_group`, `invite_to_group`, `create_channel`, `edit_chat_title`, `leave_chat`, `get_participants`, `get_admins`, `get_banned_users`, `promote_admin`, `demote_admin`, `ban_user`, `unban_user`, `subscribe_public_channel` |
| Invite links | Export/import/join links | `telegram.v2.chats`: `get_invite_link`, `export_chat_invite`, `import_chat_invite`, `join_chat_by_link` |
| Message lifecycle | Send/reply/edit/delete/forward/pin/unpin/read/context/history | `telegram.v2.messages`: `send_message`, `reply_to_message`, `edit_message`, `delete_message`, `forward_message`, `pin_message`, `unpin_message`, `mark_as_read`, `get_message_context`, `get_history`, `get_messages`, `list_messages` |
| Forum topics | Topic listing | `telegram.v2.messages`: `list_topics` |
| Polls/reactions | Poll creation and reaction flows | `telegram.v2.messages`: `create_poll`, `send_reaction`, `remove_reaction`, `get_message_reactions` |
| Contacts | List/search/add/delete/block/unblock/import/export | `telegram.v2.contacts`: `list_contacts`, `search_contacts`, `add_contact`, `delete_contact`, `block_user`, `unblock_user`, `import_contacts`, `export_contacts`, `get_blocked_users`, `get_contact_ids` |
| Contact workflows | Direct chat and related chat lookup | `telegram.v2.contacts`: `get_direct_chat_by_contact`, `get_contact_chats` |
| Profile/user info | Me/profile/status/photos | `telegram.v2.profile`: `get_me`, `update_profile`, `delete_profile_photo`, `get_user_photos`, `get_user_status` |
| Discovery/search | Public chat discovery, message search, username resolution | `telegram.v2.search`: `search_public_chats`, `search_messages`, `resolve_username` |
| Privacy/settings | Privacy rules, mute/archive, recent actions | `telegram.v2.privacy`: `get_privacy_settings`, `set_privacy_settings`, `mute_chat`, `unmute_chat`, `archive_chat`, `unarchive_chat`, `get_recent_actions` |
| Drafts | Save/list/clear drafts | `telegram.v2.drafts`: `save_draft`, `get_drafts`, `clear_draft` |
| Inline interaction | List/press inline buttons | `telegram.v2.inline`: `list_buttons`, `press_button` |
| Media/file UX | Upload/download without local path dependency | `telegram.v2.media`: `upload_init`, `upload_commit`, `download_url`, `ingest_message_media`, `send_from_object`, `list_objects`, `get_object_metadata`, `get_media_info` |
| Risk controls | Guard destructive operations | `telegram.v2.approval`: `request`, `execute`, `status` + policy/risk enforcement in tool execution path |

## Remaining Expansion Areas

- Add fully explicit tool-per-operation aliases (`telegram.v2.<domain>.<operation>`) if strict per-tool discovery is required by specific MCP clients.
- Add dedicated MTProto contract tests for each `telegram.v2.*` operation shape and handler mapping.
- Add production load/security suites that specifically target approval replay, token expiration, and media signed URL behavior.
