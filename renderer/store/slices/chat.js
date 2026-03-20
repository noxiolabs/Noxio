/**
 * @file chat.js
 * @description Redux slice for chat state: conversation list, active conversation,
 * messages, streaming state, and selected model. The streaming workflow:
 *   1. User sends message → sendChatMessage action dispatched
 *   2. ipc-middleware forwards to main via IPC
 *   3. 'stream-token' events append tokens via appendStreamToken
 *   4. 'stream-complete' event calls finaliseStream
 */

import { createSlice, nanoid } from '@reduxjs/toolkit';

/**
 * @typedef {'user'|'assistant'|'system'} MessageRole
 * @typedef {{ id: string, role: MessageRole, content: string, createdAt: number }} Message
 * @typedef {{ id: string, title: string, messages: Message[], model: string, createdAt: number }} Conversation
 */

const initialState = {
  /** All conversations, ordered by most recent first */
  conversations: [],

  /** ID of the currently open conversation, or null if none */
  activeConversationId: null,

  /** True while the assistant is streaming a response */
  streaming: false,

  /** ID of the message currently being streamed into */
  streamingMessageId: null,

  /** Currently selected model name (e.g. 'qwen2.5:14b') */
  selectedModel: null,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    /**
     * Creates a new conversation and sets it as active.
     * @param {Object} [action.payload]
     * @param {string} [action.payload.model] - Model to use for this conversation
     */
    createConversation(state, action) {
      const conversation = {
        id: nanoid(),
        title: 'New conversation',
        messages: [],
        model: action.payload?.model || state.selectedModel,
        createdAt: Date.now(),
      };
      state.conversations.unshift(conversation);
      state.activeConversationId = conversation.id;
    },

    /**
     * Sets the active conversation by ID.
     */
    setActiveConversation(state, action) {
      state.activeConversationId = action.payload;
    },

    /**
     * Appends a user message to the active conversation and starts
     * the streaming placeholder for the assistant's response.
     */
    sendMessage(state, action) {
      const { content } = action.payload;
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) return;

      // Add user message
      conv.messages.push({ id: nanoid(), role: 'user', content, createdAt: Date.now() });

      // Add empty assistant placeholder to stream into
      const assistantMsgId = nanoid();
      conv.messages.push({ id: assistantMsgId, role: 'assistant', content: '', createdAt: Date.now() });

      state.streaming = true;
      state.streamingMessageId = assistantMsgId;
    },

    /**
     * Appends a streamed token to the currently streaming message.
     * Triggered by 'stream-token' IPC event.
     */
    appendStreamToken(state, action) {
      const token = action.payload;
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv || !state.streamingMessageId) return;
      const msg = conv.messages.find((m) => m.id === state.streamingMessageId);
      if (msg) msg.content += token;
    },

    /**
     * Marks streaming as complete and updates the conversation title if it's new.
     * Triggered by 'stream-complete' IPC event.
     */
    finaliseStream(state) {
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (conv && conv.title === 'New conversation' && conv.messages.length >= 1) {
        // Auto-title: first 40 chars of the first user message
        const firstUser = conv.messages.find((m) => m.role === 'user');
        if (firstUser) {
          conv.title = firstUser.content.slice(0, 40) + (firstUser.content.length > 40 ? '…' : '');
        }
      }
      state.streaming = false;
      state.streamingMessageId = null;
    },

    /**
     * Deletes a conversation by ID.
     */
    deleteConversation(state, action) {
      state.conversations = state.conversations.filter((c) => c.id !== action.payload);
      if (state.activeConversationId === action.payload) {
        state.activeConversationId = state.conversations[0]?.id || null;
      }
    },

    /**
     * Sets the selected model.
     */
    setSelectedModel(state, action) {
      state.selectedModel = action.payload;
    },
  },
});

export const {
  createConversation,
  setActiveConversation,
  sendMessage,
  appendStreamToken,
  finaliseStream,
  deleteConversation,
  setSelectedModel,
} = chatSlice.actions;

export default chatSlice.reducer;
