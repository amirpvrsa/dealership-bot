const axios = require('axios');

const HUBSPOT_API_BASE = 'https://api.hubapi.com/crm/v3';

async function findContactByEmail(email) {
  try {
    const response = await axios.post(
      `${HUBSPOT_API_BASE}/objects/contacts/search`,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email
              }
            ]
          }
        ],
        properties: ['email', 'firstname', 'lastname', 'phone'],
        limit: 1
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.results && response.data.results.length > 0) {
      const contact = response.data.results[0];
      return {
        id: contact.id,
        properties: contact.properties
      };
    }

    return null;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] HubSpot API error in findContactByEmail:`, error.message);
    if (error.response) {
      console.error(`[${new Date().toISOString()}] HubSpot response status:`, error.response.status);
      console.error(`[${new Date().toISOString()}] HubSpot response data:`, JSON.stringify(error.response.data));
    }
    return null;
  }
}

async function getFormSubmission(contactId) {
  try {
    // First, try to get contact with form submission associations
    const response = await axios.get(
      `${HUBSPOT_API_BASE}/objects/contacts/${contactId}?associations=form_submissions`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Check if there are form submission associations
    if (response.data.associations && response.data.associations.form_submissions) {
      const formSubmissions = response.data.associations.form_submissions.results;
      
      // Look for a finance-related form
      for (const submission of formSubmissions) {
        try {
          const formResponse = await axios.get(
            `${HUBSPOT_API_BASE}/objects/form_submissions/${submission.id}`,
            {
              headers: {
                'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );

          const formName = formResponse.data.properties?.form_name || '';
          if (formName.toLowerCase().includes('finance')) {
            return formResponse.data.properties;
          }
        } catch (err) {
          console.error(`[${new Date().toISOString()}] Error fetching form submission details:`, err.message);
          continue;
        }
      }
    }

    // Alternative: Check engagements/activities timeline for form submission
    const engagementsResponse = await axios.get(
      `${HUBSPOT_API_BASE}/objects/contacts/${contactId}/associations/engagements`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (engagementsResponse.data.results) {
      for (const engagement of engagementsResponse.data.results) {
        try {
          const engagementResponse = await axios.get(
            `${HUBSPOT_API_BASE}/objects/engagements/${engagement.id}`,
            {
              headers: {
                'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
                'Content-Type': 'application/json'
              }
            }
          );

          const engagementType = engagementResponse.data.properties?.engagement_type || '';
          const metadata = engagementResponse.data.properties?.metadata || {};
          
          if (engagementType === 'FORM_SUBMISSION' || 
              (metadata.form_name && metadata.form_name.toLowerCase().includes('finance'))) {
            return metadata;
          }
        } catch (err) {
          console.error(`[${new Date().toISOString()}] Error fetching engagement details:`, err.message);
          continue;
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] HubSpot API error in getFormSubmission:`, error.message);
    if (error.response) {
      console.error(`[${new Date().toISOString()}] HubSpot response status:`, error.response.status);
      console.error(`[${new Date().toISOString()}] HubSpot response data:`, JSON.stringify(error.response.data));
    }
    return null;
  }
}

async function updateContactOwner(contactId, ownerId) {
  try {
    const response = await axios.patch(
      `${HUBSPOT_API_BASE}/objects/contacts/${contactId}`,
      {
        properties: {
          hubspot_owner_id: ownerId
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`[${new Date().toISOString()}] Updated contact ${contactId} owner to ${ownerId}`);
    return response.data;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] HubSpot API error in updateContactOwner:`, error.message);
    if (error.response) {
      console.error(`[${new Date().toISOString()}] HubSpot response status:`, error.response.status);
      console.error(`[${new Date().toISOString()}] HubSpot response data:`, JSON.stringify(error.response.data));
    }
    return null;
  }
}

module.exports = {
  findContactByEmail,
  getFormSubmission,
  updateContactOwner
};
