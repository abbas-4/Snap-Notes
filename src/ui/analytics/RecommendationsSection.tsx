import { Link } from 'react-router';
import type { RecommendationResult } from '../../domain/recommendations';
import { primaryButton, secondaryButton } from '../styles';
import { LightbulbIcon } from './Icons';
import Section, { panel } from './Section';

export default function RecommendationsSection({ result }: { result: RecommendationResult }) {
  return (
    <Section
      id="recommendations"
      title="What to study next"
      description="Suggestions worked out from your own study history, with the reason for each."
    >
      {result.kind === 'getting-started' ? (
        <div className={`${panel} border-dashed`}>
          <h3 className="font-semibold">
            {result.hasCards ? 'Study a little to unlock suggestions' : 'Add some cards to begin'}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            {result.hasCards
              ? `Suggestions appear once you have answered at least 10 cards (so far: ${result.answered}). Until then there is too little history to say anything useful, so nothing is guessed.`
              : 'Analytics are built from the cards you study. Add a few cards, then review them, and this page will fill in.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {result.hasCards ? (
              <>
                <Link to="/review" className={primaryButton}>
                  Start reviewing
                </Link>
                <Link to="/learn" className={secondaryButton}>
                  Try Learn
                </Link>
              </>
            ) : (
              <Link to="/add" className={primaryButton}>
                Add a card
              </Link>
            )}
          </div>
        </div>
      ) : result.items.length === 0 ? (
        <div className={panel}>
          <h3 className="font-semibold">You are all caught up</h3>
          <p className="mt-1 text-sm text-gray-600">
            Nothing is due, no card stands out as weak, and your goals are on track. Come back
            tomorrow, or add new cards to learn.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {result.items.map((item, index) => (
            <li
              key={item.id}
              className={`${panel} flex flex-col motion-safe:animate-rise`}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-indigo-50 p-1.5 text-indigo-700">
                  <LightbulbIcon />
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{item.reason}</p>
                </div>
              </div>
              <div className="mt-auto pt-4">
                <Link to={item.href} className={index === 0 ? primaryButton : secondaryButton}>
                  {item.action}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
