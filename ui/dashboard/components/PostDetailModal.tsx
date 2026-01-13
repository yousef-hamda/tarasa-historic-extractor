import React from 'react';
import Modal from './Modal';
import StatusBadge from './StatusBadge';
import { formatDate, getConfidenceBgColor } from '../utils/formatters';
import type { Post } from '../types';
import {
  UserIcon,
  LinkIcon,
  CalendarIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';

interface PostDetailModalProps {
  post: Post | null;
  isOpen: boolean;
  onClose: () => void;
}

const PostDetailModal: React.FC<PostDetailModalProps> = ({ post, isOpen, onClose }) => {
  if (!post) return null;

  const confidence = post.classified?.confidence ?? 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Post Details" size="xl">
      <div className="px-6 pb-6 space-y-6">
        {/* Author Section */}
        <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
          {post.authorPhoto ? (
            <img
              src={post.authorPhoto}
              alt={post.authorName || 'Author'}
              className="flex-shrink-0 w-12 h-12 rounded-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                target.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <div className={`flex-shrink-0 w-12 h-12 bg-gray-300 rounded-full flex items-center justify-center ${post.authorPhoto ? 'hidden' : ''}`}>
            <UserIcon className="h-6 w-6 text-gray-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-lg font-semibold text-gray-900">
              {post.authorName || 'Unknown Author'}
            </h4>
            {post.authorLink ? (
              <a
                href={post.authorLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                <LinkIcon className="h-4 w-4" />
                View Facebook Profile
              </a>
            ) : (
              <span className="text-sm text-gray-500">No profile link available</span>
            )}
          </div>
          <div className="text-right text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <CalendarIcon className="h-4 w-4" />
              {formatDate(post.scrapedAt)}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Group: {post.groupId}
            </div>
          </div>
        </div>

        {/* Post Content */}
        <div className="space-y-2">
          <h5 className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <ChatBubbleLeftRightIcon className="h-4 w-4" />
            Post Content
          </h5>
          <div className="p-4 bg-white border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
            <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">
              {post.text}
            </p>
          </div>
        </div>

        {/* AI Classification */}
        {post.classified ? (
          <div className="space-y-4 p-4 bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg border border-purple-100">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-5 w-5 text-purple-600" />
              <h5 className="font-semibold text-purple-900">AI Classification</h5>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Historic Status */}
              <div className="space-y-1">
                <span className="text-xs text-gray-600 uppercase tracking-wider">Classification</span>
                <div>
                  <StatusBadge
                    status={post.classified.isHistoric ? 'ok' : 'degraded'}
                    label={post.classified.isHistoric ? 'Historic Content' : 'Not Historic'}
                    size="lg"
                  />
                </div>
              </div>

              {/* Confidence Score */}
              <div className="space-y-1">
                <span className="text-xs text-gray-600 uppercase tracking-wider">Confidence Score</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${getConfidenceBgColor(confidence)}`}
                      style={{ width: `${confidence}%` }}
                    />
                  </div>
                  <span className="text-lg font-bold text-gray-900">{confidence}%</span>
                </div>
              </div>
            </div>

            {/* AI Reasoning */}
            <div className="space-y-2">
              <span className="text-xs text-gray-600 uppercase tracking-wider">AI Reasoning</span>
              <div className="p-3 bg-white rounded-lg border border-purple-100">
                <p className="text-sm text-gray-700 leading-relaxed">
                  {post.classified.reason}
                </p>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Classified at: {formatDate(post.classified.classifiedAt)}
            </div>
          </div>
        ) : (
          <div className="p-4 bg-gray-50 rounded-lg text-center">
            <SparklesIcon className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600">Not yet classified by AI</p>
            <p className="text-xs text-gray-500 mt-1">
              This post is pending classification
            </p>
          </div>
        )}

        {/* Metadata */}
        <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100">
          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
            ID: {post.id}
          </span>
          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
            FB Post: {post.fbPostId ? `${post.fbPostId.slice(0, 20)}...` : 'N/A'}
          </span>
          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
            Group: {post.groupId || 'N/A'}
          </span>
        </div>
      </div>
    </Modal>
  );
};

export default PostDetailModal;
