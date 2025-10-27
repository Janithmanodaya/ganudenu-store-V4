import React, { useEffect } from 'react'
import useSEO from '../components/useSEO.js'

export default function PolicyPage() {
  useSEO({
    title: 'Service Policy — Ganudenu Marketplace',
    description: 'Read the service policy and user responsibilities for using Ganudenu Marketplace.',
    canonical: 'https://ganudenu.store/policy'
  })

  return (
    <div className="center">
      <div className="card">
        <div className="h1">Service Policy and User Responsibilities</div>
        <p className="text-muted" style={{ marginTop: 0 }}>
          Last updated: {new Date().toLocaleDateString()}
        </p>

        <div className="h2">1) Platform Purpose</div>
        <p>
          We provide an online platform that enables buyers and sellers to discover, connect, and
          communicate. We are not a party to any transaction or agreement between users, and we do
          not guarantee, endorse, or assume responsibility for any listing, user, payment, delivery,
          or outcome.
        </p>

        <div className="h2">2) No Liability for Misuse or Crime</div>
        <p>
          We do not take responsibility for any unlawful, fraudulent, or harmful activity committed
          by users via or outside of this website. Users are solely responsible for complying with
          applicable laws and for their own actions. If you suspect illegal activity, report it to
          the appropriate authorities.
        </p>

        <div className="h2">3) User Conduct</div>
        <ul>
          <li>Only post accurate information that you have the right to share.</li>
          <li>Do not post illegal, fraudulent, or misleading content.</li>
          <li>Do not harass, threaten, or abuse other users.</li>
          <li>Comply with all applicable local laws and regulations.</li>
        </ul>

        <div className="h2">4) Listings and Transactions</div>
        <ul>
          <li>We do not verify listings unless explicitly stated.</li>
          <li>Meet in safe, public places and verify goods/services before paying.</li>
          <li>Use secure payment methods at your own discretion and risk.</li>
        </ul>

        <div className="h2">5) Content Moderation</div>
        <p>
          We may remove content or restrict accounts that violate these policies or applicable law.
          We may cooperate with law enforcement when required by law.
        </p>

        <div className="h2">6) Disclaimers</div>
        <p>
          The platform is provided “as is” and “as available” without warranties of any kind. To the
          maximum extent permitted by law, we disclaim all liability for indirect, incidental,
          special, or consequential damages, as well as loss of data, profits, or goodwill.
        </p>

        <div className="h2">7) Changes</div>
        <p>
          We may update this policy from time to time. Continued use of the platform constitutes
          acceptance of the updated policy.
        </p>
      </div>
    </div>
  )
}