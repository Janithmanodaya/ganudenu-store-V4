import React from 'react'
import useSEO from '../components/useSEO.js'

export default function TermsPage() {
  useSEO({
    title: 'Terms & Conditions — Ganudenu Marketplace',
    description: 'Read the Terms & Conditions for using Ganudenu Marketplace.',
    canonical: 'https://ganudenu.store/terms'
  })

  const today = new Date().toLocaleDateString()

  return (
    <div className="center">
      <div className="card">
        <div className="h1">Terms & Conditions</div>
        <p className="text-muted" style={{ marginTop: 0 }}>
          Last updated: {today}
        </p>

        <p>
          Ganudenu Marketplace (“Ganudenu”, “we”, “our”, “us”) provides an online platform that
          enables users to discover, list, buy and sell goods or services, subject to the Terms
          & Conditions below. By using Ganudenu, you agree to these Terms.
        </p>

        <div className="h2">General</div>
        <p>
          Advertisers and users are solely responsible for ensuring that any content they post
          (including text, images, graphics, video and other materials, collectively “Content”)
          complies with applicable laws and regulations. Ganudenu does not assume responsibility
          for illegal, inaccurate, or misleading Content posted by users.
        </p>
        <p>
          You represent and warrant that your Content does not violate any copyright, intellectual
          property, privacy or other rights of any third party. You agree to release and hold
          harmless Ganudenu from all obligations, liabilities and claims arising from your use
          of the platform.
        </p>

        <div className="h2">Copyright and License</div>
        <p>
          By posting Content on Ganudenu, you grant Ganudenu a non-exclusive, royalty-free,
          worldwide license to use, reproduce, modify, adapt, publish, translate, create derivative
          works from, and distribute such Content for the purpose of operating and promoting the
          platform.
        </p>
        <p>
          Except for user-submitted Content, all materials on Ganudenu (including code, design,
          text and media) are owned by Ganudenu or its licensors and are protected by applicable
          intellectual property laws. No material may be copied, reproduced, republished, posted,
          transmitted, stored or distributed without prior written permission.
        </p>

        <div className="h2">Images and Safety</div>
        <p>
          We may edit titles or refuse to publish images that are irrelevant or violate our rules.
          Images uploaded may be processed to prevent misuse.
        </p>

        <div className="h2">Cooperation with Authorities</div>
        <p>
          We may cooperate with law enforcement when Content violates applicable law. The identity
          of advertisers or users may be determined by service providers (e.g., ISPs). We may log
          IP addresses to ensure compliance with these Terms and to protect the platform.
        </p>

        <div className="h2">Privacy</div>
        <p>
          We collect and process information as described in our policies to operate, support and
          improve Ganudenu. By using the platform, you consent to our collection and use of your
          information, including sharing with affiliates or service providers for platform
          operations (e.g., administration, research, marketing, product development).
        </p>

        <div className="h2">Cookies</div>
        <p>
          Ganudenu uses cookies to function properly. Cookies are small files placed on your device
          that store information such as a randomized user ID. Cookies cannot read data off your
          disk or cookie files created by other sites. You can disable cookies, but some features
          may not work.
        </p>

        <div className="h2">Email Address</div>
        <p>
          Users may be required to provide a valid email address to post ads or use certain features.
          Your email is not publicly displayed; other users may contact you via platform forms or
          chat features where available.
        </p>

        <div className="h2">Site Availability</div>
        <p>
          We do not guarantee continuous or secure access. Ganudenu is provided “as is” and “as
          available”.
        </p>

        <div className="h2">Links to Third Party Websites</div>
        <p>
          Ganudenu may contain links to third party websites (“Third Party Websites”). We are not
          responsible for the content or practices of Third Party Websites. Access them at your
          own risk.
        </p>

        <div className="h2">Paid Content and Services</div>
        <p>
          Some features may require payment, including membership packages, ad posting in certain
          categories, and ad promotions. Pricing and availability may change without notice.
        </p>

        <div className="h2">Shops and Memberships</div>
        <p>
          As part of a membership package, Ganudenu may create a shop page on your behalf, with
          content provided by you. We may remove or refuse to publish content that violates these
          Terms or applicable law.
        </p>

        <div className="h2">Disclaimer</div>
        <p>
          Ganudenu assumes no responsibility for your use of the platform and disclaims all
          liability for any injury, claim, loss, or damage arising out of or related to:
        </p>
        <ul>
          <li>Errors on the site or in Content (including technical or typographical errors).</li>
          <li>Third party websites or content accessed via links.</li>
          <li>Unavailability or downtime of the site.</li>
          <li>Your use of Ganudenu or any Content.</li>
          <li>Your use of any equipment, software, or payment methods in connection with the site.</li>
        </ul>

        <div className="h2">Indemnification</div>
        <p>
          You agree to indemnify Ganudenu and its officers, directors, employees, and agents from
          and against all losses, expenses, damages, and costs (including reasonable attorneys’
          fees) resulting from any violation of these Terms (including negligent or wrongful
          conduct) or any violation of applicable law.
        </p>

        <div className="h2">Modifications</div>
        <p>
          We may modify these Terms & Conditions at any time. Changes are effective upon posting.
          Your continued use of Ganudenu constitutes acceptance of the modified Terms.
        </p>

        <div className="h2">Governing Law</div>
        <p>
          Ganudenu is operated under the laws and regulations of Sri Lanka. Any disputes shall be
          resolved under Sri Lankan law and courts having jurisdiction.
        </p>
      </div>
    </div>
  )
}