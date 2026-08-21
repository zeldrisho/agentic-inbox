// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

interface EmailPanelHeaderProps {
  subject: string;
  messageCount: number;
  showThreadCount: boolean;
}

/**
 * Renders an email panel header with an optional message count for the thread.
 *
 * @param subject - The email subject displayed in the header.
 * @param messageCount - The number of messages in the thread.
 * @param showThreadCount - Whether to display the thread message count.
 */
export default function EmailPanelHeader({
  subject,
  messageCount,
  showThreadCount,
}: EmailPanelHeaderProps) {
  return (
    <div className="px-4 py-3 border-b border-kumo-line shrink-0 md:px-6">
      <h2 className="text-base font-semibold text-kumo-default">{subject}</h2>
      {showThreadCount && (
        <span className="text-xs text-kumo-subtle mt-0.5 block">
          {messageCount} messages in this thread
        </span>
      )}
    </div>
  );
}
