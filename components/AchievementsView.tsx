"use client";

export default function AchievementsView({
  gameNames: _gameNames,
}: {
  gameNames: Record<string, string>;
}) {
  return (
    <section className="achievements-view achievements-view--coming-soon">
      <p className="achievements-view__coming-soon">Coming Soon</p>
    </section>
  );
}
