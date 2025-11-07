/**
 * Example SAM Lambda function
 * This Lambda is deployed with API Gateway via SAM template
 */

exports.handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));

  const name = event.queryStringParameters?.name || 'World';
  const userAgent = event.headers?.['User-Agent'] || 'Unknown';

  const response = {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: `Hello, ${name}!`,
      timestamp: new Date().toISOString(),
      deployedBy: 'GitHub Lambda Deployer',
      userAgent: userAgent,
      requestId: event.requestContext?.requestId,
    }),
  };

  return response;
};
